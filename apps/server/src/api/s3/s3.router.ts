/**
 * Read-only S3 surface.
 *
 * No procedure here returns object bytes. Everything on this router is JSON
 * over superjson, which would base64 a body and hold the whole object in
 * memory on the way through; bytes travel over their own streaming routes.
 */
import { s3ListObjectsSchema, s3ObjectRefSchema, s3ScopeSchema } from "@faws/contracts";
import {
  bucketConfig,
  bucketRegion,
  bucketStorageMetrics,
  bucketVersioning,
  headObject,
  listBuckets,
  listObjectsPage,
  listObjectVersions,
} from "@faws/core";
import { z } from "zod";

import { guard, publicProcedure, router } from "../../trpc/index.ts";

export const s3Router = router({
  buckets: publicProcedure
    .input(s3ScopeSchema)
    .query(({ input }) => guard(() => listBuckets(input))),

  /** Resolved on demand, because a bucket is addressed in its own region. */
  bucketRegion: publicProcedure
    .input(s3ScopeSchema.extend({ bucket: z.string().min(1) }))
    .query(({ input }) => guard(() => bucketRegion(input, input.bucket))),

  /**
   * One page of a listing. The client asks for the next one with the token
   * this returns, rather than the server walking the whole prefix.
   */
  list: publicProcedure
    .input(s3ScopeSchema.and(s3ListObjectsSchema))
    .query(({ input }) => guard(() => listObjectsPage(input, input))),

  /** Whether a delete on this bucket writes a recoverable marker. */
  versioning: publicProcedure
    .input(s3ScopeSchema.extend({ bucket: z.string().min(1) }))
    .query(({ input }) => guard(() => bucketVersioning(input, input.bucket))),

  /** Everything the properties pane shows, degrading per field. */
  config: publicProcedure
    .input(s3ScopeSchema.extend({ bucket: z.string().min(1) }))
    .query(({ input }) => guard(() => bucketConfig(input, input.bucket))),

  /** Versions and delete markers; this listing pages on two markers. */
  versions: publicProcedure
    .input(
      s3ScopeSchema.extend({
        bucket: z.string().min(1),
        prefix: z.string().max(1024).default(""),
        keyMarker: z.string().optional(),
        versionIdMarker: z.string().optional(),
      }),
    )
    .query(({ input }) =>
      guard(() =>
        listObjectVersions(input, {
          bucket: input.bucket,
          prefix: input.prefix,
          ...(input.keyMarker ? { keyMarker: input.keyMarker } : {}),
          ...(input.versionIdMarker ? { versionIdMarker: input.versionIdMarker } : {}),
        }),
      ),
    ),

  /** Daily size and object count, which is cheaper than counting. */
  storageMetrics: publicProcedure
    .input(
      s3ScopeSchema.extend({
        bucket: z.string().min(1),
        days: z.number().int().positive().max(365).optional(),
      }),
    )
    .query(({ input }) =>
      guard(() =>
        bucketStorageMetrics(
          input,
          input.bucket,
          input.days === undefined ? {} : { days: input.days },
        ),
      ),
    ),

  /** What an object is, which decides whether and how its bytes are fetched. */
  head: publicProcedure.input(s3ScopeSchema.and(s3ObjectRefSchema)).query(({ input }) =>
    guard(() =>
      headObject(input, {
        bucket: input.bucket,
        key: input.key,
        ...(input.versionId ? { versionId: input.versionId } : {}),
      }),
    ),
  ),
});
