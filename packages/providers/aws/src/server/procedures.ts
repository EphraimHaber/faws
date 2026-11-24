import { providerProcedure } from "@faws/kit/server";
import { z } from "zod";

/** Every procedure in this provider answers only while AWS is switched on. */
export const awsProcedure = providerProcedure("aws");

/** Every AWS call is scoped to the profile and region the UI shows. */
export const scopeInput = z.object({
  profile: z.string(),
  region: z.string().min(1),
});
