/**
 * Read-only S3 surface.
 *
 * No procedure here returns object bytes. Everything on this router is JSON
 * over superjson, which would base64 a body and hold the whole object in
 * memory on the way through; bytes travel over their own streaming routes.
 */
import { s3ListObjectsSchema, s3ObjectRefSchema } from "@faws/contracts";
import {
  bucketRegion,
  bucketVersioning,
  headObject,
  listBuckets,
  listObjectsPage,
} from "@faws/core";
import { z } from "zod";

import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";

export const s3Router = router({
  buckets: publicProcedure.input(scopeInput).query(({ input }) => guard(() => listBuckets(input))),

  /** Resolved on demand, because a bucket is addressed in its own region. */
  bucketRegion: publicProcedure
    .input(scopeInput.extend({ bucket: z.string().min(1) }))
    .query(({ input }) => guard(() => bucketRegion(input, input.bucket))),

  /**
   * One page of a listing. The client asks for the next one with the token
   * this returns, rather than the server walking the whole prefix.
   */
  list: publicProcedure
    .input(scopeInput.and(s3ListObjectsSchema))
    .query(({ input }) => guard(() => listObjectsPage(input, input))),

  /** Whether a delete on this bucket writes a recoverable marker. */
  versioning: publicProcedure
    .input(scopeInput.extend({ bucket: z.string().min(1) }))
    .query(({ input }) => guard(() => bucketVersioning(input, input.bucket))),

  /** What an object is, which decides whether and how its bytes are fetched. */
  head: publicProcedure.input(scopeInput.and(s3ObjectRefSchema)).query(({ input }) =>
    guard(() =>
      headObject(input, {
        bucket: input.bucket,
        key: input.key,
        ...(input.versionId ? { versionId: input.versionId } : {}),
      }),
    ),
  ),
});
