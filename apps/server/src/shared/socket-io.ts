import type {
  ClientToServerEvents,
  ExecClientToServerEvents,
  ExecInterServerEvents,
  ExecServerToClientEvents,
  ExecSocketData,
  InterServerEvents,
  S3ScanClientToServerEvents,
  S3ScanInterServerEvents,
  S3ScanServerToClientEvents,
  S3ScanSocketData,
  ServerToClientEvents,
  SocketData,
} from "@faws/socket-io-events";
import type { SettingsChangedPayload, WriteMode } from "@faws/contracts";
import type { FastifyInstance } from "fastify";
import { Namespace, Server } from "socket.io";

import { createLogger, setLogBroadcaster } from "./logger.ts";

type IOServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export type ExecNamespace = Namespace<
  ExecClientToServerEvents,
  ExecServerToClientEvents,
  ExecInterServerEvents,
  ExecSocketData
>;

export type S3ScanNamespace = Namespace<
  S3ScanClientToServerEvents,
  S3ScanServerToClientEvents,
  S3ScanInterServerEvents,
  S3ScanSocketData
>;

const log = createLogger("socket-io");

let ioInstance: IOServer | null = null;
let execNs: ExecNamespace | null = null;
let s3ScanNs: S3ScanNamespace | null = null;

export function setupSocketIO(fastify: FastifyInstance): IOServer {
  ioInstance = new Server(fastify.server, {
    path: "/ws",
    cors: { origin: true, credentials: true },
  });

  // Wire the broadcaster before the connection handler, otherwise the very
  // first "client connected" line is emitted while broadcaster is still null
  // and silently dropped.
  setLogBroadcaster((line) => {
    ioInstance?.emit("log:line", { json: line });
  });

  ioInstance.on("connection", (socket) => {
    log.info({ socketId: socket.id }, "client connected");
    socket.on("disconnect", (reason) => {
      log.info({ socketId: socket.id, reason }, "client disconnected");
    });
  });

  // Socket.IO has no `.of<T>()` overload for per-namespace event types yet,
  // so the cast is how we attach the `/exec` contract.
  execNs = ioInstance.of("/exec") as unknown as ExecNamespace;
  s3ScanNs = ioInstance.of("/s3-scan") as unknown as S3ScanNamespace;

  log.info("Socket.IO attached (in-memory adapter)");
  return ioInstance;
}

export function getExecNamespace(): ExecNamespace | null {
  return execNs;
}

export function getS3ScanNamespace(): S3ScanNamespace | null {
  return s3ScanNs;
}

/**
 * Disconnects every client and stops the server.
 *
 * Fastify's `close()` waits for open connections to drain, and a websocket
 * never drains on its own - so without this a restart hangs on "waiting for
 * graceful termination" for as long as one browser tab is open. Interactive
 * terminals and streamed key walks make that the normal case rather than the
 * unlucky one.
 */
export async function closeSocketIO(): Promise<void> {
  const io = ioInstance;
  if (!io) return;
  ioInstance = null;
  execNs = null;
  s3ScanNs = null;
  setLogBroadcaster(null);
  await new Promise<void>((resolve) => io.close(() => resolve()));
}

/** Fan-out helper used by the menu/nav bridge in the desktop shell. */
export function emitNav(target: string): void {
  ioInstance?.emit("nav", { target });
}

/** Fan-out helper for preference changes; see `api/settings/settings.events.ts`. */
export function emitSettingsChanged(payload: SettingsChangedPayload): void {
  ioInstance?.emit("settings:changed", payload);
}

/**
 * Fan-out helper for the read-only and deletion switches.
 *
 * These live in the server process, so every window is already looking at the
 * same pair - but only the window that flipped them knew it had happened. The
 * others kept their buttons in whatever state they last queried, which is the
 * one thing a safety switch must not do.
 */
export function emitWriteModeChanged(payload: WriteMode): void {
  ioInstance?.emit("write-mode:changed", payload);
}
