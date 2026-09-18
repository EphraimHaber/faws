/**
 * Preferences over tRPC.
 *
 * Thin on purpose - every rule lives in the store. Two things are absent by
 * design rather than by omission:
 *
 * - No `guard()`. That wrapper translates AWS SDK failures, and nothing here
 *   talks to AWS.
 * - No read-only check. A session started with mutations blocked is blocked
 *   from changing *someone's infrastructure*; it can still pick a theme.
 *
 * Related: `readOnly` and `destructive` in `@faws/core`'s read-only guard are
 * deliberately not in the settings file. They are seeded from the environment
 * and reset every launch, which is the point of them - a destructive-mode
 * switch that survived a restart would be a footgun, not a preference.
 */
import { settingsPatchSchema, silenceOpSchema, silencedSettingsSchema } from "@faws/contracts";
import { z } from "zod";

import { publicProcedure, router } from "../../trpc/index.ts";
import { settingsStore } from "./settings.instance.ts";

/** Identifies the window that made a change, so it can ignore its own echo. */
const originId = z.string().min(1).max(64).optional();

export const settingsRouter = router({
  get: publicProcedure.query(() => settingsStore().get()),

  update: publicProcedure
    .input(z.object({ patch: settingsPatchSchema, originId }))
    .mutation(({ input }) => settingsStore().update(input.patch, input.originId ?? null)),

  silence: publicProcedure
    .input(z.object({ op: silenceOpSchema, originId }))
    .mutation(({ input }) => settingsStore().applySilence(input.op, input.originId ?? null)),

  /**
   * Adopts what a browser had in `localStorage` before the server owned any of
   * this. Its own procedure rather than an `update` because it carries the
   * silence maps, which the patch schema excludes, and because it has to be a
   * no-op once settings exist - so two tabs racing on first load is harmless.
   */
  importLegacy: publicProcedure
    .input(
      z.object({
        patch: settingsPatchSchema,
        silenced: silencedSettingsSchema.partial().default({}),
        originId,
      }),
    )
    .mutation(({ input }) =>
      settingsStore().importLegacy(input.patch, input.silenced, input.originId ?? null),
    ),

  reset: publicProcedure
    .input(z.object({ originId }).default({}))
    .mutation(({ input }) => settingsStore().reset(input.originId ?? null)),
});
