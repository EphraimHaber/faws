import { z } from "zod";

export {
  guard,
  middleware,
  publicProcedure,
  router,
  toTrpcError,
  type Effect,
  type ProcedureMeta,
} from "@faws/kit/server";

/** Every AWS call is scoped to the profile/region the UI currently shows. */
export const scopeInput = z.object({
  profile: z.string(),
  region: z.string().min(1),
});
