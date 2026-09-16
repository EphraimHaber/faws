/**
 * Input schemas shared by the server routers and the client forms.
 *
 * One definition per operation: the tRPC procedure validates with it, and the
 * form validates with the same object, so a constraint can't be enforced on
 * one side and forgotten on the other.
 */
import { z } from "zod";

export const awsScopeSchema = z.object({
  profile: z.string(),
  region: z.string().min(1),
});

/**
 * ECS rejects an update that changes nothing, so at least one of the three
 * fields has to be present — checked here rather than in either caller.
 */
export const updateServiceSchema = z
  .object({
    cluster: z.string().min(1),
    service: z.string().min(1),
    desiredCount: z.number().int().min(0).max(5000).optional(),
    taskDefinition: z.string().min(1).optional(),
    forceNewDeployment: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.desiredCount !== undefined ||
      input.taskDefinition !== undefined ||
      input.forceNewDeployment === true,
    { message: "Change the desired count, the task definition, or force a new deployment." },
  );

export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const stopTaskSchema = z.object({
  cluster: z.string().min(1),
  taskId: z.string().min(1),
  reason: z.string().max(255).optional(),
});

export type StopTaskInput = z.infer<typeof stopTaskSchema>;
