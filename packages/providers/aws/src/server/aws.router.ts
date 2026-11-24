import { defaultRegionFor, invalidateScope, listProfiles, whoami } from "@faws/core";
import { guard, router } from "@faws/kit/server";

import { awsProcedure, scopeInput } from "./procedures.ts";

export const awsRouter = router({
  /** Profiles from ~/.aws/config + ~/.aws/credentials, for the Ctrl+P picker. */
  profiles: awsProcedure.query(() => guard(() => listProfiles())),

  defaultRegion: awsProcedure
    .input(scopeInput.pick({ profile: true }))
    .query(({ input }) => guard(() => defaultRegionFor(input.profile))),

  whoami: awsProcedure.input(scopeInput).query(({ input }) => guard(() => whoami(input))),

  /** Forces the next call to re-resolve credentials (post SSO login, etc). */
  refreshCredentials: awsProcedure
    .meta({ effect: "local" })
    .input(scopeInput)
    .mutation(({ input }) => {
      invalidateScope(input);
      return { ok: true } as const;
    }),
});
