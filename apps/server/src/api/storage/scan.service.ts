/**
 * `/storage-scan` namespace - recursive key walks.
 *
 * A scan is a stream rather than a request: a prefix can hold millions of
 * keys, and the matches that arrive first are worth showing while the rest are
 * still being read.
 *
 * Cancellation has three independent triggers, all reaching the same
 * controller: the stop button, the socket closing, and the walk's own ceiling.
 * The middle one matters most - navigating away has to stop the work rather
 * than leave it running unobserved against someone's bucket.
 */
import { connectionRefSchema, type StorageObjectSummary } from "@faws/kit";
import { assertProviderEnabled, objectStorageFor } from "@faws/kit/server";
import type {
  StorageScanClientToServerEvents,
  StorageScanHandshakeAuth,
  StorageScanInterServerEvents,
  StorageScanServerToClientEvents,
  StorageScanSocketData,
} from "@faws/socket-io-events";
import type { Socket } from "socket.io";
import { z } from "zod";

import { createLogger } from "../../shared/logger.ts";
import type { StorageScanNamespace } from "../../shared/socket-io.ts";
import { toTrpcError } from "../../trpc/index.ts";

const log = createLogger("storage-scan");

const handshake = z.object({
  scanId: z.string().min(1),
  ref: connectionRefSchema,
  bucket: z.string().min(1),
  prefix: z.string().max(1024).default(""),
  pattern: z.string().max(256).optional(),
  maxObjects: z.number().int().positive().max(1_000_000).default(200_000),
  maxSeconds: z.number().int().positive().max(600).default(120),
});

/** Hits are flushed on whichever of these comes first. */
const FLUSH_EVERY_MS = 250;
const FLUSH_EVERY_HITS = 500;

type ScanSocket = Socket<
  StorageScanClientToServerEvents,
  StorageScanServerToClientEvents,
  StorageScanInterServerEvents,
  StorageScanSocketData
>;

export function attachStorageScanNamespace(namespace: StorageScanNamespace): void {
  namespace.on("connection", (socket) => {
    const parsed = handshake.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      socket.emit("scan:error", {
        code: "BAD_HANDSHAKE",
        userMessage: "The scan request was malformed.",
      });
      socket.disconnect(true);
      return;
    }

    const input = parsed.data;
    const auth: StorageScanHandshakeAuth = {
      scanId: input.scanId,
      ref: input.ref,
      bucket: input.bucket,
      prefix: input.prefix,
      ...(input.pattern ? { pattern: input.pattern } : {}),
      maxObjects: input.maxObjects,
      maxSeconds: input.maxSeconds,
    };

    const controller = new AbortController();
    socket.on("scan:cancel", () => controller.abort());
    socket.on("disconnect", () => controller.abort());

    void run(socket, auth, controller);
  });
}

async function run(
  socket: ScanSocket,
  auth: StorageScanHandshakeAuth,
  controller: AbortController,
): Promise<void> {
  let buffer: StorageObjectSummary[] = [];
  let lastFlush = Date.now();

  try {
    assertProviderEnabled(auth.ref.provider);
    for await (const chunk of objectStorageFor(auth.ref).scan(
      auth.ref,
      {
        bucket: auth.bucket,
        prefix: auth.prefix,
        ...(auth.pattern ? { pattern: auth.pattern } : {}),
        maxObjects: auth.maxObjects,
        maxSeconds: auth.maxSeconds,
      },
      controller.signal,
    )) {
      buffer.push(...chunk.objects);

      // Batching by both count and age keeps a fast bucket from emitting a
      // message per page, while a slow one still reports that it is moving.
      const due = buffer.length >= FLUSH_EVERY_HITS || Date.now() - lastFlush >= FLUSH_EVERY_MS;

      if (chunk.progress.done || due) {
        if (buffer.length > 0) {
          socket.emit("scan:chunk", { objects: buffer });
          buffer = [];
        }
        socket.emit("scan:progress", chunk.progress);
        lastFlush = Date.now();
      }

      if (chunk.progress.done) {
        socket.emit("scan:done", { progress: chunk.progress, rollup: chunk.rollup });
      }
    }
  } catch (err) {
    // An abort is how a scan is meant to end early, not a failure to report.
    if (!controller.signal.aborted) {
      const mapped = toTrpcError(err);
      log.warn({ err, bucket: auth.bucket, prefix: auth.prefix }, "scan failed");
      socket.emit("scan:error", { code: mapped.code, userMessage: mapped.message });
    }
  } finally {
    if (socket.connected) socket.disconnect(true);
  }
}
