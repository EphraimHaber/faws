/**
 * `/exec` namespace - interactive shells into containers and container
 * instances.
 *
 * The transport is in place (handshake typing, lifecycle, teardown) but no
 * driver is registered yet, so a connection gets a clear refusal instead of
 * hanging. A driver is a factory that owns a PTY-ish child process
 * (`aws ecs execute-command` or `session-manager-plugin`) and pumps bytes
 * both ways.
 */
import type { ExecHandshakeAuth } from "@faws/socket-io-events";

import { createLogger } from "../../shared/logger.ts";
import type { ExecNamespace } from "../../shared/socket-io.ts";

const log = createLogger("exec");

export interface ExecDriver {
  write(chunk: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export type ExecDriverFactory = (
  auth: ExecHandshakeAuth,
  sink: {
    data(chunk: string): void;
    exit(code: number | null, reason: string | null): void;
    error(code: string, userMessage: string): void;
  },
) => ExecDriver;

const drivers = new Map<"ecs" | "ssm", ExecDriverFactory>();

export function registerExecDriver(mode: "ecs" | "ssm", factory: ExecDriverFactory): void {
  drivers.set(mode, factory);
}

export function attachExecNamespace(namespace: ExecNamespace): void {
  namespace.on("connection", (socket) => {
    const auth = socket.handshake.auth as unknown as ExecHandshakeAuth;
    const mode = (process.env["FAWS_EXEC_MODE"] as "ecs" | "ssm" | undefined) ?? "ecs";
    const factory = drivers.get(mode);

    if (!factory) {
      log.warn({ socketId: socket.id, mode }, "exec connection with no driver registered");
      socket.emit("exec:error", {
        code: "NotImplemented",
        userMessage: "Interactive exec is not available in this build.",
      });
      socket.disconnect(true);
      return;
    }

    const driver = factory(auth, {
      data: (chunk) => socket.emit("exec:data", { chunk }),
      exit: (code, reason) => {
        socket.emit("exec:exit", { code, reason });
        socket.disconnect(true);
      },
      error: (code, userMessage) => socket.emit("exec:error", { code, userMessage }),
    });

    socket.on("exec:input", ({ chunk }) => driver.write(chunk));
    socket.on("exec:resize", ({ cols, rows }) => driver.resize(cols, rows));
    socket.on("exec:close", () => driver.close());
    socket.on("disconnect", () => driver.close());

    socket.emit("exec:ready", { sessionId: auth.sessionId });
  });
}
