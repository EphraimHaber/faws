import { defaultRegionFor, invalidateScope, listProfiles, whoami } from "@faws/core";

import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";

export const awsRouter = router({
  /** Profiles from ~/.aws/config + ~/.aws/credentials, for the Ctrl+P picker. */
  profiles: publicProcedure.query(() => guard(() => listProfiles())),

  defaultRegion: publicProcedure
    .input(scopeInput.pick({ profile: true }))
    .query(({ input }) => guard(() => defaultRegionFor(input.profile))),

  whoami: publicProcedure.input(scopeInput).query(({ input }) => guard(() => whoami(input))),

  /** Forces the next call to re-resolve credentials (post SSO login, etc). */
  refreshCredentials: publicProcedure.input(scopeInput).mutation(({ input }) => {
    invalidateScope(input);
    return { ok: true } as const;
  }),
});
