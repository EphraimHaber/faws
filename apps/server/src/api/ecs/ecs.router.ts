/**
 * Read-only ECS surface: the clusters -> services -> tasks -> containers
 * drill-down, plus the detail panes (deployments, events, task definitions,
 * metrics, logs).
 *
 * Mutations (update service, stop task, register task definition, exec)
 * are deliberately absent from this router — they land behind
 * `assertMutable` in a separate `ecs.actions` router so read-only mode
 * stays a structural guarantee rather than a per-handler check.
 */
import {
  fetchLogEvents,
  getService,
  getTask,
  getTaskDefinition,
  listClusters,
  listContainerInstances,
  listServices,
  listTaskDefinitionFamilies,
  listTaskDefinitionRevisions,
  listTasks,
  serviceDeploymentHistory,
  serviceMetrics,
  serviceTargetHealth,
  taskDefinitionLogConfigs,
} from "@faws/core";
import { z } from "zod";

import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";

const clusterInput = scopeInput.extend({ cluster: z.string().min(1) });

export const ecsRouter = router({
  clusters: publicProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listClusters(input))),

  services: publicProcedure
    .input(clusterInput)
    .query(({ input }) => guard(() => listServices(input, input.cluster))),

  service: publicProcedure
    .input(clusterInput.extend({ service: z.string().min(1) }))
    .query(({ input }) => guard(() => getService(input, input.cluster, input.service))),

  tasks: publicProcedure
    .input(
      clusterInput.extend({
        service: z.string().optional(),
        containerInstance: z.string().optional(),
        desiredStatus: z.enum(["RUNNING", "STOPPED"]).optional(),
      }),
    )
    .query(({ input }) =>
      guard(() =>
        listTasks(input, {
          cluster: input.cluster,
          ...(input.service ? { serviceName: input.service } : {}),
          ...(input.containerInstance ? { containerInstance: input.containerInstance } : {}),
          ...(input.desiredStatus ? { desiredStatus: input.desiredStatus } : {}),
        }),
      ),
    ),

  task: publicProcedure
    .input(clusterInput.extend({ taskId: z.string().min(1) }))
    .query(({ input }) => guard(() => getTask(input, input.cluster, input.taskId))),

  containerInstances: publicProcedure
    .input(clusterInput)
    .query(({ input }) => guard(() => listContainerInstances(input, input.cluster))),

  taskDefinitionFamilies: publicProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listTaskDefinitionFamilies(input))),

  taskDefinitionRevisions: publicProcedure
    .input(scopeInput.extend({ family: z.string().min(1) }))
    .query(({ input }) => guard(() => listTaskDefinitionRevisions(input, input.family))),

  taskDefinition: publicProcedure
    .input(scopeInput.extend({ taskDefinition: z.string().min(1) }))
    .query(({ input }) => guard(() => getTaskDefinition(input, input.taskDefinition))),

  metrics: publicProcedure
    .input(
      clusterInput.extend({
        service: z.string().min(1),
        windowMinutes: z.number().int().positive().max(10_080).optional(),
      }),
    )
    .query(({ input }) =>
      guard(() =>
        serviceMetrics(input, {
          cluster: input.cluster,
          service: input.service,
          ...(input.windowMinutes ? { windowMinutes: input.windowMinutes } : {}),
        }),
      ),
    ),

  /**
   * Past deployments, which `service` cannot return — DescribeServices only
   * reports the deployments that are still active.
   */
  deploymentHistory: publicProcedure
    .input(
      clusterInput.extend({
        service: z.string().min(1),
        limit: z.number().int().positive().max(50).optional(),
      }),
    )
    .query(({ input }) =>
      guard(() => serviceDeploymentHistory(input, input.cluster, input.service, input.limit ?? 20)),
    ),

  /**
   * Load balancer target health for a service. Separate from `service` because
   * it polls faster during a rollout and touches a different AWS API — a
   * missing elasticloadbalancing permission shouldn't blank the service page.
   */
  targetHealth: publicProcedure
    .input(clusterInput.extend({ service: z.string().min(1) }))
    .query(({ input }) =>
      guard(async () => {
        const detail = await getService(input, input.cluster, input.service);
        if (!detail) return [];
        return serviceTargetHealth(input, detail.service);
      }),
    ),

  /** Where each container in a task definition writes its logs. */
  logConfig: publicProcedure
    .input(scopeInput.extend({ taskDefinition: z.string().min(1) }))
    .query(({ input }) => guard(() => taskDefinitionLogConfigs(input, input.taskDefinition))),

  logs: publicProcedure
    .input(
      scopeInput.extend({
        logGroup: z.string().min(1),
        logStreamPrefix: z.string().optional(),
        startTime: z.number().int().optional(),
        endTime: z.number().int().optional(),
        filterPattern: z.string().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      }),
    )
    .query(({ input }) =>
      guard(() =>
        fetchLogEvents(input, {
          logGroup: input.logGroup,
          ...(input.logStreamPrefix ? { logStreamPrefix: input.logStreamPrefix } : {}),
          ...(input.startTime ? { startTime: input.startTime } : {}),
          ...(input.endTime ? { endTime: input.endTime } : {}),
          ...(input.filterPattern ? { filterPattern: input.filterPattern } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        }),
      ),
    ),
});
