import { listExecTargets } from "@faws/core";

import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";
import { listSessions } from "./session.registry.ts";
import { resolveSessionPlugin } from "./sessionPlugin.ts";

/**
 * Everything about shells that is a question rather than a stream.
 *
 * `diagnostics` exists so the terminal UI can say "the Session Manager plugin
 * is not installed, here is the command" on the panel, before anyone picks a
 * target and presses Enter. Discovering a missing dependency at the moment you
 * expected a prompt is a bad way to learn it.
 */
export const execRouter = router({
  diagnostics: publicProcedure.query(() => {
    const plugin = resolveSessionPlugin();
    return {
      pluginPath: plugin.path,
      pluginSource: plugin.source,
      pluginProblem: plugin.problem,
      sshAgent: process.env["SSH_AUTH_SOCK"] !== undefined,
    };
  }),

  /** EC2 instances and how each one could be reached. */
  targets: publicProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listExecTargets(input))),

  sessions: publicProcedure.query(() => listSessions()),
});
