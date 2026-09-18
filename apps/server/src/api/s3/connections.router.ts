/**
 * Saved S3 endpoints, and the trust decisions that go with them.
 *
 * These procedures edit local configuration rather than anything in a bucket,
 * so the write switches do not apply to them: refusing to save an endpoint
 * while in read only mode would leave no way to reach the endpoint the mode is
 * protecting. What they do carry is a key on the way in and never on the way
 * out.
 */
import { s3ConnectionInputSchema, s3ConnectionRefSchema } from "@faws/contracts";
import {
  credentialStore,
  deleteConnection,
  invalidateConnection,
  probeConnection,
  saveConnection,
} from "@faws/core";

import { createLogger } from "../../shared/logger.ts";
import { guard, publicProcedure, router } from "../../trpc/index.ts";

const log = createLogger("s3-connections");

export const s3ConnectionsRouter = router({
  /**
   * Which credentials exist, and which key id each one is.
   *
   * The half that proves the key is never part of this: a form needs to say
   * "this endpoint signs as AKIA..." and nothing more.
   */
  credentials: publicProcedure.query(() => guard(() => credentialStore().summaries())),

  save: publicProcedure.input(s3ConnectionInputSchema).mutation(({ input }) =>
    guard(async () => {
      const connection = await saveConnection(input);
      // Credentials and certificates are read once when a client is built, so
      // an edit that is not followed by this is an edit that does not apply.
      invalidateConnection(connection.id);
      log.info(
        { id: connection.id, endpoint: connection.endpoint, verify: connection.tls.verify },
        "s3 connection saved",
      );
      return connection;
    }),
  ),

  remove: publicProcedure.input(s3ConnectionRefSchema).mutation(({ input }) =>
    guard(async () => {
      await deleteConnection(input.id);
      invalidateConnection(input.id);
      return { ok: true } as const;
    }),
  ),

  /**
   * Tests what is in the form, saving nothing.
   *
   * The certificate comes back whether or not it was trusted, because that is
   * what an operator needs in front of them to decide between adding a CA,
   * pinning this one certificate, and turning verification off.
   */
  test: publicProcedure
    .input(s3ConnectionInputSchema)
    .mutation(({ input }) => guard(() => probeConnection(input))),
});
