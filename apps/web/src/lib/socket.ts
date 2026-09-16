import type {
  ClientToServerEvents,
  ExecClientToServerEvents,
  ExecHandshakeAuth,
  ExecServerToClientEvents,
  ServerToClientEvents,
} from "@faws/socket-io-events";
import { io, type Socket } from "socket.io-client";

import { resolveServerOrigin } from "./apiUrl.ts";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ExecSocket = Socket<ExecServerToClientEvents, ExecClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(resolveServerOrigin(), {
      path: "/ws",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    }) as AppSocket;
  }
  return socket;
}

/**
 * Each terminal tab gets its own `/exec` connection: the handshake payload is
 * per-session, and reconnect is owned by the tab rather than by socket.io.
 */
export function createExecSocket(auth: ExecHandshakeAuth): ExecSocket {
  return io(`${resolveServerOrigin()}/exec`, {
    path: "/ws",
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    auth: auth as unknown as Record<string, unknown>,
  }) as ExecSocket;
}
