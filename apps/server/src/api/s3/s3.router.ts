/**
 * Read-only S3 surface.
 *
 * No procedure here returns object bytes. Everything on this router is JSON
 * over superjson, which would base64 a body and hold the whole object in
 * memory on the way through; bytes travel over their own streaming routes.
 */
import { s3ListObjectsSchema } from "@faws/contracts";
import { bucketRegion, listBuckets, listObjectsPage } from "@faws/core";
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
});
