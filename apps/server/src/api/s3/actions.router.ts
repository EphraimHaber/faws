/**
 * Mutating S3 operations.
 *
 * Unlike the ECS actions these have real bodies, so the guards matter. Each
 * one is called inside the core function as well as here: the byte routes
 * bypass tRPC entirely and have to meet the same check.
 */
import {
  s3AbortUploadSchema,
  s3CompleteUploadSchema,
  s3CopyObjectSchema,
  s3CreatePrefixSchema,
  s3CreateUploadSchema,
  s3DeleteObjectsSchema,
  s3PutTagsSchema,
} from "@faws/contracts";
import {
  assertDestructive,
  assertMutable,
  completeMultipartUpload,
  copyObject,
  createMultipartUpload,
  createPrefix,
  deleteObjects,
  putObjectTags,
  scanPrefix,
} from "@faws/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createLogger } from "../../shared/logger.ts";
import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";
import { closeUpload, discardUpload, findUpload, openUpload } from "./uploads.ts";

const log = createLogger("s3-actions");

/** Below this an upload is one request; above it, parts. */
const MULTIPART_THRESHOLD = 8 * 1024 * 1024;

/** How far a dry run walks before it reports what it found so far. */
const DRY_RUN_CEILING = 50_000;

export const s3ActionsRouter = router({
  /**
   * What a recursive delete would hit.
   *
   * The confirm dialog states a count and a size, and it has to be a measured
   * one: "delete everything under here" is the operation people most want a
   * number in front of.
   */
  dryRunDelete: publicProcedure
    .input(scopeInput.extend({ bucket: z.string().min(1), prefix: z.string().max(1024) }))
    .query(({ input }) =>
      guard(async () => {
        const controller = new AbortController();
        let objectCount = 0;
        let totalBytes = 0;
        let truncated = false;

        for await (const chunk of scanPrefix(
          input,
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

  createUpload: publicProcedure.input(scopeInput.and(s3CreateUploadSchema)).mutation(({ input }) =>
    guard(async () => {
      if (input.overwrite) assertDestructive("s3:PutObject (overwrite)");
      else assertMutable("s3:PutObject");

      const scope = { profile: input.profile, region: input.region };
      const multipart = input.size > MULTIPART_THRESHOLD;
      const uploadId = multipart
        ? await createMultipartUpload(scope, {
            bucket: input.bucket,
            key: input.key,
            contentType: input.contentType,
          })
        : null;

      const session = openUpload({
        scope,
        bucket: input.bucket,
        key: input.key,
        uploadId,
        overwrite: input.overwrite,
        contentType: input.contentType,
      });

      return { uploadToken: session.token, multipart };
    }),
  ),

  completeUpload: publicProcedure.input(s3CompleteUploadSchema).mutation(({ input }) =>
    guard(async () => {
      const session = findUpload(input.uploadToken);
      if (!session?.uploadId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That upload is no longer open." });
      }

      const result = await completeMultipartUpload(session.scope, {
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

  abortUpload: publicProcedure.input(s3AbortUploadSchema).mutation(({ input }) =>
    guard(async () => {
      await discardUpload(input.uploadToken);
      return { ok: true } as const;
    }),
  ),

  deleteObjects: publicProcedure
    .input(scopeInput.and(s3DeleteObjectsSchema))
    .mutation(({ input }) =>
      guard(async () => {
        const outcome = await deleteObjects(input, {
          bucket: input.bucket,
          objects: input.objects,
        });
        log.warn(
          {
            bucket: input.bucket,
            requested: input.objects.length,
            deleted: outcome.deleted.length,
            failed: outcome.errors.length,
            profile: input.profile,
          },
          "objects deleted",
        );
        return outcome;
      }),
    ),

  copyObject: publicProcedure.input(scopeInput.and(s3CopyObjectSchema)).mutation(({ input }) =>
    guard(async () => {
      const result = await copyObject(input, input);
      log.warn(
        {
          from: `${input.sourceBucket}/${input.sourceKey}`,
          to: `${input.destBucket}/${input.destKey}`,
          move: input.deleteSource,
          profile: input.profile,
        },
        input.deleteSource ? "object moved" : "object copied",
      );
      return result;
    }),
  ),

  createPrefix: publicProcedure
    .input(scopeInput.and(s3CreatePrefixSchema))
    .mutation(({ input }) =>
      guard(() => createPrefix(input, { bucket: input.bucket, prefix: input.prefix })),
    ),

  putTags: publicProcedure
    .input(scopeInput.and(s3PutTagsSchema))
    .mutation(({ input }) =>
      guard(() => putObjectTags(input, { bucket: input.bucket, key: input.key, tags: input.tags })),
    ),
});
