import {
  defaultRegionFor,
  invalidateScope,
  listProfiles,
  setDestructiveAllowed,
  setReadOnly,
  whoami,
  writeMode,
} from "@faws/core";
import { z } from "zod";

import { emitWriteModeChanged } from "../../shared/socket-io.ts";
import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";
import { awsProcedure } from "../../trpc/providers.ts";

export const awsRouter = router({
  /** Profiles from ~/.aws/config + ~/.aws/credentials, for the Ctrl+P picker. */
  profiles: awsProcedure.query(() => guard(() => listProfiles())),

  defaultRegion: awsProcedure
    .input(scopeInput.pick({ profile: true }))
    .query(({ input }) => guard(() => defaultRegionFor(input.profile))),

  whoami: awsProcedure.input(scopeInput).query(({ input }) => guard(() => whoami(input))),

  /**
   * The two switches in front of every mutation, app wide rather than per
   * service: the second one is what separates writing something new from
   * destroying something that was already there.
   */
  writeMode: publicProcedure.query(() => writeMode()),

  setWriteMode: publicProcedure
    .meta({ effect: "local" })
    .input(z.object({ readOnly: z.boolean().optional(), destructive: z.boolean().optional() }))
    .mutation(({ input }) => {
      if (input.readOnly !== undefined) setReadOnly(input.readOnly);
      if (input.destructive !== undefined) setDestructiveAllowed(input.destructive);
      // Told to every window, not just the one that asked. The switches are
      // process-wide, so a window that missed the change would keep offering
      // writes this process will refuse - or, worse, keep a delete button
      // looking armed after someone else disarmed it.
      const next = writeMode();
      emitWriteModeChanged(next);
      return next;
    }),

  /** Forces the next call to re-resolve credentials (post SSO login, etc). */
  refreshCredentials: awsProcedure
    .meta({ effect: "local" })
    .input(scopeInput)
    .mutation(({ input }) => {
      invalidateScope(input);
      return { ok: true } as const;
    }),
});
