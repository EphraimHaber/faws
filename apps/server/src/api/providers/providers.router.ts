import { publicProcedure, router } from "../../trpc/index.ts";
import { detectProviders } from "./detect.ts";

/** About providers as a whole, which is why none of it is gated on one being on. */
export const providersRouter = router({
  detect: publicProcedure.query(() => detectProviders()),
});
