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
import { assertMutable } from "@faws/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router, scopeInput, toTrpcError } from "../../trpc/index.ts";

function notImplemented(operation: string): never {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${operation} is not wired up yet in this build.`,
  });
}

function begin(operation: string): void {
  try {
    assertMutable(operation);
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
    begin("ecs:StopTask");
    notImplemented("Stop task");
  }),

  registerTaskDefinition: publicProcedure
    .input(scopeInput.extend({ taskDefinitionJson: z.string().min(1) }))
    .mutation(() => {
      begin("ecs:RegisterTaskDefinition");
      notImplemented("Register task definition");
    }),
});
