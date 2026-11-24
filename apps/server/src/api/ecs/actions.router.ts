/**
 * Mutating ECS operations.
 *
 * Each procedure declares its effect, so read-only mode refuses the whole
 * surface before a body runs. Stopping a task is `destructive`: the container
 * is gone and the work it was doing is gone with it, so it answers to the
 * deletion switch as well as to read-only. The bodies are stubs for now:
 * the shell wires the UI affordances (update service, stop task, register
 * task definition) end-to-end, and each `NOT_IMPLEMENTED` marks where the
 * real SDK call goes.
 */
import { stopTaskSchema, updateServiceSchema } from "@faws/contracts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { router, scopeInput } from "../../trpc/index.ts";
import { awsProcedure } from "../../trpc/providers.ts";

function notImplemented(operation: string): never {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${operation} is not wired up yet in this build.`,
  });
}

export const ecsActionsRouter = router({
  updateService: awsProcedure
    .meta({ effect: "write", operation: "ecs:UpdateService" })
    .input(scopeInput.and(updateServiceSchema))
    .mutation(() => {
      notImplemented("Update service");
    }),

  stopTask: awsProcedure
    .meta({ effect: "destructive", operation: "ecs:StopTask" })
    .input(scopeInput.and(stopTaskSchema))
    .mutation(() => {
      notImplemented("Stop task");
    }),

  registerTaskDefinition: awsProcedure
    .meta({ effect: "write", operation: "ecs:RegisterTaskDefinition" })
    .input(scopeInput.extend({ taskDefinitionJson: z.string().min(1) }))
    .mutation(() => {
      notImplemented("Register task definition");
    }),
});
