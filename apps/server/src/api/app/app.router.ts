import { setDestructiveAllowed, setReadOnly, writeMode } from "@faws/kit/guard";
import { z } from "zod";

import { emitWriteModeChanged } from "../../shared/socket-io.ts";
import { publicProcedure, router } from "../../trpc/index.ts";

/** The app's own state, which belongs to no provider. */
export const appRouter = router({
  /**
   * The two switches in front of every mutation, app wide rather than per
   * provider: the second one is what separates writing something new from
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
});
