/**
 * Read-only S3 surface.
 *
 * No procedure here returns object bytes. Everything on this router is JSON
 * over superjson, which would base64 a body and hold the whole object in
 * memory on the way through; bytes travel over their own streaming routes.
 */
import { bucketRegion, listBuckets } from "@faws/core";
import { z } from "zod";

import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";

export const s3Router = router({
  buckets: publicProcedure.input(scopeInput).query(({ input }) => guard(() => listBuckets(input))),

  /** Resolved on demand, because a bucket is addressed in its own region. */
  bucketRegion: publicProcedure
    .input(scopeInput.extend({ bucket: z.string().min(1) }))
    .query(({ input }) => guard(() => bucketRegion(input, input.bucket))),
});
