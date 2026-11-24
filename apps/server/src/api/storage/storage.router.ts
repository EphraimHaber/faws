/**
 * The object storage capability over tRPC.
 *
 * Every procedure takes a `ConnectionRef` and is answered by the port its
 * provider registered, so AWS's S3 and a saved MinIO are the same calls with a
 * different `ref`. No procedure here returns object bytes: superjson would
 * base64 a body and hold it whole in memory, so bytes travel over their own
 * streaming routes.
 *
 * The write guards are checked inside each port method as well as by the
 * declared effect here, because the byte routes reach the same methods
 * without passing through tRPC.
 */
import {
  s3AbortUploadSchema,
  s3CompleteUploadSchema,
  s3CopyObjectSchema,
  s3CreatePrefixSchema,
  s3CreateUploadSchema,
  s3DeleteObjectsSchema,
  s3ListObjectsSchema,
  s3ObjectRefSchema,
  s3PresignPartSchema,
  s3PutTagsSchema,
} from "@faws/contracts";
import { connectionRefSchema } from "@faws/kit";
import { assertDestructive, assertMutable } from "@faws/kit/guard";
import { assertProviderEnabled, objectStorageFor } from "@faws/kit/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createLogger } from "../../shared/logger.ts";
import { guard, router } from "../../trpc/index.ts";
import { storageProcedure } from "../../trpc/providers.ts";
import {
  closeUpload,
  discardUpload,
  findUpload,
  openUpload,
  type UploadSession,
} from "./uploads.ts";

const log = createLogger("storage");

/** Below this an upload is one request; above it, parts. */
const MULTIPART_THRESHOLD = 8 * 1024 * 1024;

/** How far a dry run walks before it reports what it found so far. */
const DRY_RUN_CEILING = 50_000;

const onConnection = z.object({ ref: connectionRefSchema });
const onBucket = onConnection.extend({ bucket: z.string().min(1) });

/**
 * The open upload a token names, gated on its provider still being on.
 *
 * These calls carry no `ref` of their own; the session holds the one the
 * upload was opened against.
 */
function openSession(token: string): UploadSession & { uploadId: string } {
  const session = findUpload(token);
  if (!session?.uploadId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That upload is no longer open." });
  }
  assertProviderEnabled(session.ref.provider);
  return { ...session, uploadId: session.uploadId };
}

export const storageRouter = router({
  /** What the panes may offer for this connection. */
  features: storageProcedure
    .input(onConnection)
    .query(({ input }) => guard(() => objectStorageFor(input.ref).features(input.ref))),

  buckets: storageProcedure
    .input(onConnection)
    .query(({ input }) => guard(() => objectStorageFor(input.ref).listBuckets(input.ref))),

  /** Resolved on demand, because a bucket may be addressed in its own region. */
  bucketRegion: storageProcedure
    .input(onBucket)
    .query(({ input }) =>
      guard(() => objectStorageFor(input.ref).bucketRegion(input.ref, input.bucket)),
    ),

  /**
   * One page of a listing. The client asks for the next one with the token
   * this returns, rather than the server walking the whole prefix.
   */
  list: storageProcedure.input(onConnection.and(s3ListObjectsSchema)).query(({ input }) =>
    guard(() =>
      objectStorageFor(input.ref).listObjects(input.ref, {
        bucket: input.bucket,
        prefix: input.prefix,
        delimiter: input.delimiter,
        maxKeys: input.maxKeys,
        cursor: input.cursor ?? undefined,
      }),
    ),
  ),

  /** Whether a delete on this bucket writes a recoverable marker. */
  versioning: storageProcedure
    .input(onBucket)
    .query(({ input }) =>
      guard(() => objectStorageFor(input.ref).bucketVersioning(input.ref, input.bucket)),
    ),

  /** Everything the properties pane shows, degrading per field. */
  config: storageProcedure
    .input(onBucket)
    .query(({ input }) =>
      guard(() => objectStorageFor(input.ref).bucketConfig(input.ref, input.bucket)),
    ),

  /** Versions and delete markers; this listing pages on two markers. */
  versions: storageProcedure
    .input(
      onBucket.extend({
        prefix: z.string().max(1024).default(""),
        keyMarker: z.string().optional(),
        versionIdMarker: z.string().optional(),
      }),
    )
    .query(({ input }) =>
      guard(() =>
        objectStorageFor(input.ref).listVersions(input.ref, {
          bucket: input.bucket,
          prefix: input.prefix,
          keyMarker: input.keyMarker,
          versionIdMarker: input.versionIdMarker,
        }),
      ),
    ),

  /** Daily size and object count, which is cheaper than counting. */
  storageMetrics: storageProcedure
    .input(onBucket.extend({ days: z.number().int().positive().max(365).default(30) }))
    .query(({ input }) =>
      guard(() =>
        objectStorageFor(input.ref).storageMetrics(input.ref, input.bucket, { days: input.days }),
      ),
    ),

  /** What an object is, which decides whether and how its bytes are fetched. */
  head: storageProcedure.input(onConnection.and(s3ObjectRefSchema)).query(({ input }) =>
    guard(() =>
      objectStorageFor(input.ref).head(input.ref, {
        bucket: input.bucket,
        key: input.key,
        versionId: input.versionId,
      }),
    ),
  ),

  /**
   * What a recursive delete would hit.
   *
   * The confirm dialog states a count and a size, and it has to be a measured
   * one: "delete everything under here" is the operation people most want a
   * number in front of.
   */
  dryRunDelete: storageProcedure
    .input(onBucket.extend({ prefix: z.string().max(1024) }))
    .query(({ input }) =>
      guard(async () => {
        const controller = new AbortController();
        let objectCount = 0;
        let totalBytes = 0;
        let truncated = false;

        for await (const chunk of objectStorageFor(input.ref).scan(
          input.ref,
          {
            bucket: input.bucket,
            prefix: input.prefix,
            maxObjects: DRY_RUN_CEILING,
            maxSeconds: 30,
          },
          controller.signal,
        )) {
          objectCount = chunk.progress.scanned;
          totalBytes = chunk.progress.bytes;
          truncated = chunk.progress.truncated;
        }

        return { objectCount, totalBytes, truncated };
      }),
    ),

  createUpload: storageProcedure
    .meta({ effect: "write", operation: "s3:PutObject" })
    .input(onConnection.and(s3CreateUploadSchema))
    .mutation(({ input }) =>
      guard(async () => {
        if (input.overwrite) assertDestructive("s3:PutObject (overwrite)");
        else assertMutable("s3:PutObject");

        const port = objectStorageFor(input.ref);
        const multipart = input.size > MULTIPART_THRESHOLD;
        const uploadId = multipart
          ? await port.createUpload(input.ref, {
              bucket: input.bucket,
              key: input.key,
              contentType: input.contentType,
            })
          : null;

        const session = openUpload({
          ref: input.ref,
          bucket: input.bucket,
          key: input.key,
          uploadId,
          overwrite: input.overwrite,
          contentType: input.contentType,
          transport: input.transport,
        });

        // A single presigned upload needs no further round trip: that one URL is
        // the whole transfer. A multipart one signs each part on demand, because
        // ten thousand URLs up front is a response nobody wants and signatures
        // expire while the upload is still running.
        const url =
          input.transport === "presigned" && !multipart
            ? await port.presignPut(input.ref, {
                bucket: input.bucket,
                key: input.key,
                contentType: input.contentType,
                overwrite: input.overwrite,
              })
            : null;

        return { uploadToken: session.token, multipart, transport: input.transport, url };
      }),
    ),

  /**
   * A signed URL for one part.
   *
   * Signed on demand rather than in a batch at the start: a signature is only
   * useful for as long as it is valid, and a large upload outlives the URLs it
   * would have been given up front.
   */
  presignPart: storageProcedure
    .meta({ effect: "write", operation: "s3:UploadPart" })
    .input(s3PresignPartSchema)
    .mutation(({ input }) =>
      guard(async () => {
        const session = openSession(input.uploadToken);
        const url = await objectStorageFor(session.ref).presignPart(session.ref, {
          bucket: session.bucket,
          key: session.key,
          uploadId: session.uploadId,
          partNumber: input.partNumber,
        });
        return { url };
      }),
    ),

  completeUpload: storageProcedure
    .meta({ effect: "write", operation: "s3:CompleteMultipartUpload" })
    .input(s3CompleteUploadSchema)
    .mutation(({ input }) =>
      guard(async () => {
        const session = openSession(input.uploadToken);
        const result = await objectStorageFor(session.ref).completeUpload(session.ref, {
          bucket: session.bucket,
          key: session.key,
          uploadId: session.uploadId,
          parts: input.parts,
          overwrite: session.overwrite,
        });

        closeUpload(input.uploadToken);
        log.info(
          { bucket: session.bucket, key: session.key, parts: input.parts.length },
          "upload completed",
        );
        return result;
      }),
    ),

  abortUpload: storageProcedure
    .meta({ effect: "write", operation: "s3:AbortMultipartUpload" })
    .input(s3AbortUploadSchema)
    .mutation(({ input }) =>
      guard(async () => {
        await discardUpload(input.uploadToken);
        return { ok: true } as const;
      }),
    ),

  deleteObjects: storageProcedure
    .meta({ effect: "destructive", operation: "s3:DeleteObjects" })
    .input(onConnection.and(s3DeleteObjectsSchema))
    .mutation(({ input }) =>
      guard(async () => {
        const outcome = await objectStorageFor(input.ref).deleteObjects(input.ref, {
          bucket: input.bucket,
          objects: input.objects,
        });
        log.warn(
          {
            bucket: input.bucket,
            requested: input.objects.length,
            deleted: outcome.deleted.length,
            failed: outcome.errors.length,
            provider: input.ref.provider,
          },
          "objects deleted",
        );
        return outcome;
      }),
    ),

  copyObject: storageProcedure
    .meta({ effect: "write", operation: "s3:CopyObject" })
    .input(onConnection.and(s3CopyObjectSchema))
    .mutation(({ input }) =>
      guard(async () => {
        const result = await objectStorageFor(input.ref).copyObject(input.ref, {
          sourceBucket: input.sourceBucket,
          sourceKey: input.sourceKey,
          sourceVersionId: input.sourceVersionId,
          destBucket: input.destBucket,
          destKey: input.destKey,
          deleteSource: input.deleteSource,
          overwrite: input.overwrite,
        });
        log.warn(
          {
            from: `${input.sourceBucket}/${input.sourceKey}`,
            to: `${input.destBucket}/${input.destKey}`,
            move: input.deleteSource,
            provider: input.ref.provider,
          },
          input.deleteSource ? "object moved" : "object copied",
        );
        return result;
      }),
    ),

  createPrefix: storageProcedure
    .meta({ effect: "write", operation: "s3:PutObject (prefix)" })
    .input(onConnection.and(s3CreatePrefixSchema))
    .mutation(({ input }) =>
      guard(() =>
        objectStorageFor(input.ref).createPrefix(input.ref, {
          bucket: input.bucket,
          prefix: input.prefix,
        }),
      ),
    ),

  putTags: storageProcedure
    .meta({ effect: "write", operation: "s3:PutObjectTagging" })
    .input(onConnection.and(s3PutTagsSchema))
    .mutation(({ input }) =>
      guard(() =>
        objectStorageFor(input.ref).putTags(input.ref, {
          bucket: input.bucket,
          key: input.key,
          tags: input.tags,
        }),
      ),
    ),
});
