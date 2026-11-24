/**
 * `/exec` namespace - interactive shells into containers, instances and hosts.
 *
 * This file owns the socket end of a session and nothing else: it parses the
 * handshake, picks a driver by `kind`, and pumps bytes. What a driver does to
 * produce those bytes - spawn `session-manager-plugin`, dial ssh2 - is the
 * driver's business, and drivers never see a socket in return.
 *
 * The mode used to come from `FAWS_EXEC_MODE`, a process-wide env var, which
 * could only ever describe one session. It is the handshake's job, because two
 * tabs open at once are routinely different kinds.
 */
import type {
  ExecErrorCode,
  ExecHandshakeAuth,
  ExecPrompt,
  ExecPromptResponse,
} from "@faws/contracts";
import { execHandshakeSchema, execPromptResponseSchema } from "@faws/contracts";
import {
  providerDisabledError,
  type ExecContext as KitExecContext,
  type ExecDriverFactory as KitExecDriverFactory,
} from "@faws/kit/server";

import { createLogger } from "../../shared/logger.ts";
import type { ExecNamespace } from "../../shared/socket-io.ts";
import { isExecSessionError } from "./errors.ts";
import {
  answerSessionPrompt,
  attachSession,
  closeSession,
  detachSession,
  resizeSession,
  writeToSession,
  type SessionClient,
} from "./session.registry.ts";

const log = createLogger("exec");

export type { ExecDriver, ExecSink } from "@faws/kit/server";

export type ExecContext = KitExecContext<ExecPrompt, ExecPromptResponse>;
export type ExecDriverFactory = KitExecDriverFactory<
  ExecHandshakeAuth,
  ExecPrompt,
  ExecPromptResponse
>;

interface RegisteredDriver {
  readonly factory: ExecDriverFactory;
  /**
   * The provider whose contribution would serve this handshake, or null for
   * the host's own. A function because one kind can be served by several:
   * SSH is the host's, but an SSH handshake over an SSM tunnel is AWS's.
   */
  readonly provider: (auth: ExecHandshakeAuth) => string | null;
}

const drivers = new Map<ExecHandshakeAuth["kind"], RegisteredDriver>();

export function registerExecDriver(
  kind: ExecHandshakeAuth["kind"],
  factory: ExecDriverFactory,
  provider: string | null | ((auth: ExecHandshakeAuth) => string | null) = null,
): void {
  drivers.set(kind, {
    factory,
    provider: typeof provider === "function" ? provider : () => provider,
  });
}

export type DriverChoice =
  | { readonly ok: true; readonly factory: ExecDriverFactory }
  | { readonly ok: false; readonly code: ExecErrorCode; readonly userMessage: string };

/**
 * The driver that would open this handshake, or why none will.
 *
 * Checked on every connection rather than by leaving drivers unregistered, so
 * switching a provider back on takes effect without a restart - the same rule
 * its tRPC procedures follow.
 */
export function chooseDriver(auth: ExecHandshakeAuth): DriverChoice {
  const registered = drivers.get(auth.kind);
  if (!registered) {
    return {
      ok: false,
      code: "NoDriver",
      userMessage: `No ${auth.kind} driver is available in this build.`,
    };
  }
  const provider = registered.provider(auth);
  const refused = provider === null ? null : providerDisabledError(provider);
  if (refused) return { ok: false, code: "ProviderDisabled", userMessage: refused.message };
  return { ok: true, factory: registered.factory };
}

/**
 * socket.io hands binary through as a Buffer on Node and an ArrayBuffer in the
 * browser, and a hostile client can send neither. Normalising here keeps every
 * driver's `write` honest about taking bytes.
 */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

export function attachExecNamespace(namespace: ExecNamespace): void {
  namespace.use((socket, next) => {
    const parsed = execHandshakeSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      log.warn({ socketId: socket.id, issues: parsed.error.issues }, "bad exec handshake");
      next(
        Object.assign(new Error("Malformed exec handshake"), {
          data: { code: "BadHandshake", issues: parsed.error.issues },
        }),
      );
      return;
    }
    socket.data.auth = parsed.data;
    next();
  });

  namespace.on("connection", (socket) => {
    const auth = socket.data.auth;
    const choice = chooseDriver(auth);

    if (!choice.ok) {
      log.warn(
        { socketId: socket.id, kind: auth.kind, code: choice.code },
        "exec connection refused",
      );
      socket.emit("exec:error", { code: choice.code, userMessage: choice.userMessage });
      socket.disconnect(true);
      return;
    }
    const factory = choice.factory;

    const client: SessionClient = {
      data: (chunk) => socket.emit("exec:data", { chunk }),
      exit: (code, reason) => socket.emit("exec:exit", { code, reason }),
      error: (code, userMessage) => socket.emit("exec:error", { code, userMessage }),
      status: (message) => socket.emit("exec:status", { message }),
      prompt: (prompt) => socket.emit("exec:prompt", prompt),
    };

    // Wired before the attach resolves, so input typed into a terminal that is
    // still connecting is not dropped on the floor.
    socket.on("exec:input", ({ chunk }) => {
      const bytes = toBytes(chunk);
      if (!bytes) {
        log.warn({ socketId: socket.id }, "dropped non-binary exec:input");
        return;
      }
      writeToSession(auth.sessionId, bytes);
    });
    socket.on("exec:resize", ({ cols, rows }) => resizeSession(auth.sessionId, cols, rows));
    socket.on("exec:prompt:response", (payload) => {
      const parsed = execPromptResponseSchema.safeParse(payload);
      if (parsed.success) answerSessionPrompt(auth.sessionId, parsed.data);
    });
    socket.on("exec:close", () => {
      void closeSession(auth.sessionId, "closed by client");
      socket.disconnect(true);
    });
    // A dropped socket detaches rather than closes: the grace window is what
    // makes a flaky network survivable instead of fatal to a running shell.
    socket.on("disconnect", (reason) => detachSession(auth.sessionId, reason));

    void attachSession(auth, client, factory)
      .then(({ resumed }) => socket.emit("exec:ready", { sessionId: auth.sessionId, resumed }))
      .catch((err: unknown) => {
        const code = isExecSessionError(err) ? err.code : "Internal";
        const userMessage = err instanceof Error ? err.message : String(err);
        log.warn({ err, sessionId: auth.sessionId }, "exec session failed to start");
        socket.emit("exec:error", { code, userMessage });
        socket.disconnect(true);
      });
  });
}
