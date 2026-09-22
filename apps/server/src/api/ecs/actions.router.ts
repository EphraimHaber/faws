/**
 * Mutating ECS operations.
 *
 * Every handler calls `assertMutable` first, so flipping read-only mode on
 * disables the whole surface in one place. The bodies are stubs for now:
 * the shell wires the UI affordances (update service, stop task, register
 * task definition) end-to-end, and each `NOT_IMPLEMENTED` marks where the
 * real SDK call goes.
 */
import { stopTaskSchema, updateServiceSchema } from "@faws/contracts";
import { assertDestructive, assertMutable } from "@faws/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router, scopeInput, toTrpcError } from "../../trpc/index.ts";

function notImplemented(operation: string): never {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${operation} is not wired up yet in this build.`,
  });
}

/**
 * The guard in front of a handler, translated for the wire.
 *
 * `need` is the difference between writing something new and destroying
 * something that was already there. Stopping a task is the second kind: the
 * container is gone and the work it was doing is gone with it, so it answers
 * to the deletion switch as well as to read-only.
 */
function begin(operation: string, need: "write" | "destructive" = "write"): void {
  try {
    if (need === "destructive") assertDestructive(operation);
    else assertMutable(operation);
  } catch (err) {
    throw toTrpcError(err);
  }
}

export const ecsActionsRouter = router({
  updateService: publicProcedure.input(scopeInput.and(updateServiceSchema)).mutation(() => {
    begin("ecs:UpdateService");
    notImplemented("Update service");
  }),

  stopTask: publicProcedure.input(scopeInput.and(stopTaskSchema)).mutation(() => {
    begin("ecs:StopTask", "destructive");
    notImplemented("Stop task");
  }),

  registerTaskDefinition: publicProcedure
    .input(scopeInput.extend({ taskDefinitionJson: z.string().min(1) }))
    .mutation(() => {
      begin("ecs:RegisterTaskDefinition");
      notImplemented("Register task definition");
    }),
});
