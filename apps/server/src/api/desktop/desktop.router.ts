import { z } from "zod";

import { emitNav } from "../../shared/socket-io.ts";
import { publicProcedure, router } from "../../trpc/index.ts";

export const desktopRouter = router({
  /**
   * The Electron menu can't call into the renderer's router directly, so main
   * posts here and the server fans it out as a `nav` Socket.IO event.
   */
  emitNav: publicProcedure.input(z.object({ target: z.string().min(1) })).mutation(({ input }) => {
    emitNav(input.target);
    return { ok: true } as const;
  }),
});
