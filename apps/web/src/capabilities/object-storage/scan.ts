import type { S3ObjectSummary, S3PrefixRollup, S3ScanProgress } from "@faws/contracts";
import type {
  S3ScanClientToServerEvents,
  S3ScanHandshakeAuth,
  S3ScanServerToClientEvents,
} from "@faws/socket-io-events";
import { io, type Socket } from "socket.io-client";

import { resolveServerOrigin } from "./apiUrl.ts";

export type S3ScanSocket = Socket<S3ScanServerToClientEvents, S3ScanClientToServerEvents>;

export interface ScanHandlers {
  onChunk(objects: ReadonlyArray<S3ObjectSummary>): void;
  onProgress(progress: S3ScanProgress): void;
  onDone(progress: S3ScanProgress, rollup: S3PrefixRollup): void;
  onError(message: string): void;
}

export interface RunningScan {
  /** Stops the walk on the server, not just the listening here. */
  cancel(): void;
}

/**
 * Starts a recursive scan and streams its hits back.
 *
 * Each scan gets its own connection, as the terminal sessions do: the walk
 * belongs to the socket, so closing it is a cancellation the server acts on
 * rather than a client that has merely stopped listening.
 */
export function startScan(auth: S3ScanHandshakeAuth, handlers: ScanHandlers): RunningScan {
  const socket = io(`${resolveServerOrigin()}/s3-scan`, {
    path: "/ws",
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    auth: auth as unknown as Record<string, unknown>,
  }) as S3ScanSocket;

  socket.on("s3scan:chunk", (payload) => handlers.onChunk(payload.objects));
  socket.on("s3scan:progress", (progress) => handlers.onProgress(progress));
  socket.on("s3scan:done", (payload) => {
    handlers.onDone(payload.progress, payload.rollup);
    socket.disconnect();
  });
  socket.on("s3scan:error", (payload) => {
    handlers.onError(payload.userMessage);
    socket.disconnect();
  });
  socket.on("connect_error", (err) => handlers.onError(err.message));

  return {
    cancel: () => {
      // Told, then dropped: the message is what stops the walk mid page, and
      // the disconnect covers the case where it never arrives.
      if (socket.connected) socket.emit("s3scan:cancel");
      socket.disconnect();
    },
  };
}
