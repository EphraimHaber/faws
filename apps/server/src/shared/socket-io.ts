import type {
  ClientToServerEvents,
  ExecClientToServerEvents,
  ExecInterServerEvents,
  ExecServerToClientEvents,
  ExecSocketData,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@faws/socket-io-events";
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

const log = createLogger("socket-io");

let ioInstance: IOServer | null = null;
let execNs: ExecNamespace | null = null;

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

  log.info("Socket.IO attached (in-memory adapter)");
  return ioInstance;
}

export function getExecNamespace(): ExecNamespace | null {
  return execNs;
}

/** Fan-out helper used by the menu/nav bridge in the desktop shell. */
export function emitNav(target: string): void {
  ioInstance?.emit("nav", { target });
}
