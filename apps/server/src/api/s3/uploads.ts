/**
 * Upload sessions in flight.
 *
 * The byte route never accepts a bucket, key and upload id from its caller: it
 * takes an opaque token minted here. A raw write route reachable on loopback
 * is the last place to accept a caller's own idea of where the bytes should
 * land, and the token is what keeps that decision on this side.
 *
 * Sessions live in memory because they are meaningless across a restart: the
 * client would have to start the upload again anyway.
 */
import type { AwsScope } from "@faws/contracts";
import { abortMultipartUpload } from "@faws/core";

import { createLogger } from "../../shared/logger.ts";

const log = createLogger("s3-upload");

export interface UploadSession {
  readonly token: string;
  readonly scope: AwsScope;
  readonly bucket: string;
  readonly key: string;
  /** Absent for an upload small enough to go in one request. */
  readonly uploadId: string | null;
  readonly overwrite: boolean;
  readonly contentType: string;
  readonly startedAt: number;
}

const sessions = new Map<string, UploadSession>();

/** An upload abandoned for this long is swept; a multipart bills until it is. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 15 * 60 * 1000;

export function openUpload(session: Omit<UploadSession, "token" | "startedAt">): UploadSession {
  const full: UploadSession = {
    ...session,
    token: crypto.randomUUID(),
    startedAt: Date.now(),
  };
  sessions.set(full.token, full);
  return full;
}

export function findUpload(token: string): UploadSession | undefined {
  return sessions.get(token);
}

export function closeUpload(token: string): void {
  sessions.delete(token);
}

/**
 * Drops a session and abandons whatever it had started.
 *
 * Failing to abort is logged rather than raised: the caller is usually already
 * handling the reason the upload is being abandoned.
 */
export async function discardUpload(token: string): Promise<void> {
  const session = sessions.get(token);
  sessions.delete(token);
  if (!session?.uploadId) return;

  try {
    await abortMultipartUpload(session.scope, {
      bucket: session.bucket,
      key: session.key,
      uploadId: session.uploadId,
    });
  } catch (err) {
    log.warn({ err, bucket: session.bucket, key: session.key }, "could not abort upload");
  }
}

const sweeper = setInterval(() => {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [token, session] of sessions) {
    if (session.startedAt < cutoff) void discardUpload(token);
  }
}, SWEEP_EVERY_MS);

// The sweeper is housekeeping; it should never be the reason the process stays
// alive when everything else has finished.
sweeper.unref();
