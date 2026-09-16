import {
  DescribeServicesCommand,
  ListServicesCommand,
  type Deployment,
  type Service,
} from "@aws-sdk/client-ecs";
import type {
  AwsScope,
  EcsDeployment,
  EcsService,
  EcsServiceDetail,
  EcsServiceEvent,
  ServiceDeploymentState,
} from "@faws/contracts";
import { arnTail, splitTaskDefinition, taskDefinitionLabel, toIso } from "@faws/shared";

import { callAws, chunk, collectPages, ecsClient } from "../../clients.ts";

export async function listServices(scope: AwsScope, cluster: string): Promise<EcsService[]> {
  const client = ecsClient(scope);

  const arns = await collectPages<string>(async (nextToken) => {
    const page = await callAws("ecs", () =>
      client.send(new ListServicesCommand({ cluster, ...(nextToken ? { nextToken } : {}) })),
    );
    return {
      items: page.serviceArns ?? [],
      ...(page.nextToken ? { nextToken: page.nextToken } : {}),
    };
  });
  if (arns.length === 0) return [];

  const described = await describeServices(scope, cluster, arns);
  return described
    .map((s) => toService(s, cluster))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export async function getService(
  scope: AwsScope,
  cluster: string,
  service: string,
): Promise<EcsServiceDetail | null> {
  const [described] = await describeServices(scope, cluster, [service]);
  if (!described) return null;
  return {
    service: toService(described, cluster),
    deployments: (described.deployments ?? []).map(toDeployment),
    events: (described.events ?? []).slice(0, 100).map((event): EcsServiceEvent => ({
      id: event.id ?? "",
      createdAt: toIso(event.createdAt),
      message: event.message ?? "",
    })),
  };
}

async function describeServices(
  scope: AwsScope,
  cluster: string,
  ids: ReadonlyArray<string>,
): Promise<Service[]> {
  const client = ecsClient(scope);
  const out: Service[] = [];
  // DescribeServices accepts at most 10 identifiers per call.
  for (const batch of chunk(ids, 10)) {
    const page = await callAws("ecs", () =>
      client.send(new DescribeServicesCommand({ cluster, services: batch, include: ["TAGS"] })),
    );
    out.push(...(page.services ?? []));
  }
  return out;
}

function toService(service: Service, clusterName: string): EcsService {
  const taskDefinition = service.taskDefinition ?? "";
  const { family, revision } = splitTaskDefinition(taskDefinition);
  const primary = service.deployments?.find((d) => d.status === "PRIMARY");
  const breaker = service.deploymentConfiguration?.deploymentCircuitBreaker;
  return {
    name: service.serviceName ?? arnTail(service.serviceArn),
    arn: service.serviceArn ?? "",
    clusterName,
    status: service.status ?? "UNKNOWN",
    launchType: service.launchType ?? null,
    schedulingStrategy: service.schedulingStrategy ?? null,
    desiredCount: service.desiredCount ?? 0,
    runningCount: service.runningCount ?? 0,
    pendingCount: service.pendingCount ?? 0,
    taskDefinition: taskDefinitionLabel(taskDefinition),
    taskDefinitionFamily: family,
    taskDefinitionRevision: revision,
    platformVersion: service.platformVersion ?? null,
    deploymentState: deriveDeploymentState(service, primary),
    activeDeployments: service.deployments?.length ?? 0,
    createdAt: toIso(service.createdAt),
    lastDeploymentAt: toIso(primary?.createdAt),
    lastDeploymentUpdatedAt: toIso(primary?.updatedAt),
    rolloutState: primary?.rolloutState ?? null,
    rolloutStateReason: primary?.rolloutStateReason ?? null,
    failedTasks: primary?.failedTasks ?? 0,
    steadySince: primary?.rolloutState === "COMPLETED" ? toIso(primary.updatedAt) : null,
    loadBalancers: (service.loadBalancers ?? []).map((lb) => ({
      targetGroupArn: lb.targetGroupArn ?? null,
      containerName: lb.containerName ?? null,
      containerPort: lb.containerPort ?? null,
    })),
    enableExecuteCommand: service.enableExecuteCommand ?? false,
    circuitBreaker: breaker
      ? { enabled: breaker.enable ?? false, rollback: breaker.rollback ?? false }
      : null,
    minimumHealthyPercent: service.deploymentConfiguration?.minimumHealthyPercent ?? null,
    maximumPercent: service.deploymentConfiguration?.maximumPercent ?? null,
    tags: Object.fromEntries((service.tags ?? []).map((t) => [t.key ?? "", t.value ?? ""])),
  };
}

/**
 * One badge that answers "is this service OK right now?" — the question the
 * drill-down flow is really about. AWS spreads the answer across
 * rolloutState, deployment count, and the running/desired gap.
 */
function deriveDeploymentState(
  service: Service,
  primary: Deployment | undefined,
): ServiceDeploymentState {
  if (service.status === "DRAINING") return "draining";
  const rollout = primary?.rolloutState;
  if (rollout === "FAILED") return "degraded";
  if (rollout === "IN_PROGRESS") return "deploying";
  if ((service.deployments?.length ?? 0) > 1) return "deploying";
  if (rollout === "COMPLETED") {
    return (service.runningCount ?? 0) === (service.desiredCount ?? 0) ? "steady" : "degraded";
  }
  if (service.desiredCount !== undefined && service.runningCount !== undefined) {
    return service.runningCount === service.desiredCount ? "steady" : "degraded";
  }
  return "unknown";
}

function toDeployment(deployment: Deployment): EcsDeployment {
  return {
    id: deployment.id ?? "",
    status: deployment.status ?? "UNKNOWN",
    taskDefinition: taskDefinitionLabel(deployment.taskDefinition),
    desiredCount: deployment.desiredCount ?? 0,
    runningCount: deployment.runningCount ?? 0,
    pendingCount: deployment.pendingCount ?? 0,
    failedTasks: deployment.failedTasks ?? 0,
    rolloutState: deployment.rolloutState ?? null,
    rolloutStateReason: deployment.rolloutStateReason ?? null,
    createdAt: toIso(deployment.createdAt),
    updatedAt: toIso(deployment.updatedAt),
  };
}
