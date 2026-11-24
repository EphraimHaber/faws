import type { StorageObjectSummary, StoragePrefixRollup, StorageScanProgress } from "@faws/kit";
import type {
  StorageScanClientToServerEvents,
  StorageScanHandshakeAuth,
  StorageScanServerToClientEvents,
} from "@faws/socket-io-events";
import { io, type Socket } from "socket.io-client";

import { resolveServerOrigin } from "~/lib/apiUrl";

export type StorageScanSocket = Socket<
  StorageScanServerToClientEvents,
  StorageScanClientToServerEvents
>;

export interface ScanHandlers {
  onChunk(objects: ReadonlyArray<StorageObjectSummary>): void;
  onProgress(progress: StorageScanProgress): void;
  onDone(progress: StorageScanProgress, rollup: StoragePrefixRollup): void;
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
export function startScan(auth: StorageScanHandshakeAuth, handlers: ScanHandlers): RunningScan {
  const socket = io(`${resolveServerOrigin()}/storage-scan`, {
    path: "/ws",
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    auth: auth as unknown as Record<string, unknown>,
  }) as StorageScanSocket;

  socket.on("scan:chunk", (payload) => handlers.onChunk(payload.objects));
  socket.on("scan:progress", (progress) => handlers.onProgress(progress));
  socket.on("scan:done", (payload) => {
    handlers.onDone(payload.progress, payload.rollup);
    socket.disconnect();
  });
  socket.on("scan:error", (payload) => {
    handlers.onError(payload.userMessage);
    socket.disconnect();
  });
  socket.on("connect_error", (err) => handlers.onError(err.message));

  return {
    cancel: () => {
      // Told, then dropped: the message is what stops the walk mid page, and
      // the disconnect covers the case where it never arrives.
      if (socket.connected) socket.emit("scan:cancel");
      socket.disconnect();
    },
  };
}
