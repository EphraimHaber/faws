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
import type { ExecHandshakeAuth, ExecPrompt, ExecPromptResponse } from "@faws/contracts";
import { execHandshakeSchema, execPromptResponseSchema } from "@faws/contracts";

import { createLogger } from "../../shared/logger.ts";
import type { ExecNamespace } from "../../shared/socket-io.ts";

const log = createLogger("exec");

export interface ExecDriver {
  write(chunk: Uint8Array): void;
  resize(cols: number, rows: number): void;
  /** Idempotent: every teardown path funnels here, and several can race. */
  close(reason: string): void | Promise<void>;
}

/** What a driver can send back without knowing a socket exists. */
export interface ExecSink {
  data(chunk: Uint8Array): void;
  exit(code: number | null, reason: string | null): void;
  error(code: string, userMessage: string): void;
  /** One line of connect progress, for the several-second paths. */
  status(message: string): void;
}

export interface ExecContext {
  readonly log: ReturnType<typeof createLogger>;
  /**
   * Asks the person something and waits. Rejects if they cancel, if the tab
   * goes away, or on timeout - all three are refusals, never consent.
   */
  ask(prompt: ExecPrompt): Promise<ExecPromptResponse>;
  /**
   * Aborts when the client disconnects, so a slow connect actually cancels its
   * AWS calls instead of finishing into a socket nobody is holding.
   */
  readonly signal: AbortSignal;
}

/**
 * Async because every driver awaits before its first byte - ExecuteCommand,
 * StartSession, an SSH handshake. A synchronous factory would force each one to
 * fire-and-forget its setup and hand-roll a buffer for input that arrives
 * before the connection is up.
 */
export type ExecDriverFactory = (
  auth: ExecHandshakeAuth,
  sink: ExecSink,
  ctx: ExecContext,
) => Promise<ExecDriver>;

const drivers = new Map<ExecHandshakeAuth["kind"], ExecDriverFactory>();

export function registerExecDriver(
  kind: ExecHandshakeAuth["kind"],
  factory: ExecDriverFactory,
): void {
  drivers.set(kind, factory);
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
    const factory = drivers.get(auth.kind);
    const sessionLog = log.child({
      socketId: socket.id,
      sessionId: auth.sessionId,
      kind: auth.kind,
    });

    if (!factory) {
      sessionLog.warn("exec connection with no driver registered");
      socket.emit("exec:error", {
        code: "NoDriver",
        userMessage: `No ${auth.kind} driver is available in this build.`,
      });
      socket.disconnect(true);
      return;
    }

    const abort = new AbortController();
    const pending = new Map<string, (response: ExecPromptResponse) => void>();

    const sink: ExecSink = {
      data: (chunk) => socket.emit("exec:data", { chunk }),
      exit: (code, reason) => socket.emit("exec:exit", { code, reason }),
      error: (code, userMessage) => socket.emit("exec:error", { code, userMessage }),
      status: (message) => socket.emit("exec:status", { message }),
    };

    const ctx: ExecContext = {
      log: sessionLog,
      signal: abort.signal,
      ask: (prompt) =>
        new Promise((resolve, reject) => {
          pending.set(prompt.promptId, resolve);
          abort.signal.addEventListener(
            "abort",
            () => {
              pending.delete(prompt.promptId);
              reject(new Error("The session went away before the prompt was answered."));
            },
            { once: true },
          );
          socket.emit("exec:prompt", prompt);
        }),
    };

    socket.on("exec:prompt:response", (payload) => {
      const parsed = execPromptResponseSchema.safeParse(payload);
      if (!parsed.success) return;
      const resolve = pending.get(parsed.data.promptId);
      if (!resolve) return;
      pending.delete(parsed.data.promptId);
      resolve(parsed.data);
    });

    void (async () => {
      let driver: ExecDriver;
      try {
        driver = await factory(auth, sink, ctx);
      } catch (err) {
        const code = (err as { execCode?: string }).execCode ?? "Internal";
        const message = err instanceof Error ? err.message : String(err);
        sessionLog.warn({ err, code }, "exec driver failed to start");
        socket.emit("exec:error", { code, userMessage: message });
        socket.disconnect(true);
        return;
      }

      // The client may have given up while we were connecting.
      if (abort.signal.aborted) {
        void driver.close("client left during connect");
        return;
      }

      socket.on("exec:input", ({ chunk }) => {
        const bytes = toBytes(chunk);
        if (!bytes) {
          sessionLog.warn("dropped non-binary exec:input");
          return;
        }
        driver.write(bytes);
      });
      socket.on("exec:resize", ({ cols, rows }) => driver.resize(cols, rows));
      socket.on("exec:close", () => void driver.close("closed by client"));
      socket.on("disconnect", (reason) => void driver.close(`socket disconnected: ${reason}`));

      socket.emit("exec:ready", { sessionId: auth.sessionId, resumed: false });
    })();

    socket.on("disconnect", () => abort.abort());
  });
}
