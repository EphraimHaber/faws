import {
  DescribeTasksCommand,
  ListTasksCommand,
  type Container,
  type Task,
} from "@aws-sdk/client-ecs";
import type { AwsScope, EcsContainer, EcsTask } from "@faws/contracts";
import { arnTail, taskDefinitionLabel, toIso } from "@faws/shared";

import { callAws, chunk, collectPages, ecsClient } from "../../clients.ts";

export interface ListTasksOptions {
  readonly cluster: string;
  readonly serviceName?: string;
  readonly containerInstance?: string;
  /** e1s shows stopped tasks as a separate view; we make it a filter. */
  readonly desiredStatus?: "RUNNING" | "STOPPED";
}

export async function listTasks(scope: AwsScope, options: ListTasksOptions): Promise<EcsTask[]> {
  const client = ecsClient(scope);
  const base = {
    cluster: options.cluster,
    ...(options.serviceName ? { serviceName: options.serviceName } : {}),
    ...(options.containerInstance ? { containerInstance: options.containerInstance } : {}),
    desiredStatus: options.desiredStatus ?? "RUNNING",
  };

  const arns = await collectPages<string>(async (nextToken) => {
    const page = await callAws("ecs", () =>
      client.send(new ListTasksCommand({ ...base, ...(nextToken ? { nextToken } : {}) })),
    );
    return { items: page.taskArns ?? [], ...(page.nextToken ? { nextToken: page.nextToken } : {}) };
  });
  if (arns.length === 0) return [];

  const described = await describeTasks(scope, options.cluster, arns);
  return described
    .map((task) => toTask(task, options.cluster))
    .toSorted((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export async function getTask(
  scope: AwsScope,
  cluster: string,
  taskId: string,
): Promise<EcsTask | null> {
  const [task] = await describeTasks(scope, cluster, [taskId]);
  return task ? toTask(task, cluster) : null;
}

async function describeTasks(
  scope: AwsScope,
  cluster: string,
  ids: ReadonlyArray<string>,
): Promise<Task[]> {
  const client = ecsClient(scope);
  const out: Task[] = [];
  // DescribeTasks accepts at most 100 identifiers per call.
  for (const batch of chunk(ids, 100)) {
    const page = await callAws("ecs", () =>
      client.send(new DescribeTasksCommand({ cluster, tasks: batch, include: ["TAGS"] })),
    );
    out.push(...(page.tasks ?? []));
  }
  return out;
}

function toTask(task: Task, clusterName: string): EcsTask {
  const containers = (task.containers ?? []).map(toContainer);
  // The task's own attachment carries the awsvpc ENI; for bridge/host mode
  // the address only shows up on the container, so fall back to that.
  const eniIp =
    task.attachments?.flatMap((a) => a.details ?? []).find((d) => d.name === "privateIPv4Address")
      ?.value ?? null;
  const containerIp =
    containers.flatMap((c) => c.networkInterfaces).find((n) => n.privateIpv4Address)
      ?.privateIpv4Address ?? null;

  return {
    id: arnTail(task.taskArn),
    arn: task.taskArn ?? "",
    clusterName,
    serviceName: serviceNameFromGroup(task.group),
    group: task.group ?? null,
    lastStatus: task.lastStatus ?? "UNKNOWN",
    desiredStatus: task.desiredStatus ?? "UNKNOWN",
    health: task.healthStatus ?? "UNKNOWN",
    launchType: task.launchType ?? null,
    capacityProvider: task.capacityProviderName ?? null,
    cpu: task.cpu ?? null,
    memory: task.memory ?? null,
    taskDefinition: taskDefinitionLabel(task.taskDefinitionArn),
    containerInstanceArn: task.containerInstanceArn ?? null,
    availabilityZone: task.availabilityZone ?? null,
    startedAt: toIso(task.startedAt ?? task.createdAt),
    stoppedAt: toIso(task.stoppedAt),
    stoppedReason: task.stoppedReason ?? null,
    enableExecuteCommand: task.enableExecuteCommand ?? false,
    privateIp: eniIp ?? containerIp,
    containers,
  };
}

/** Service-launched tasks carry `service:<name>` in their group field. */
function serviceNameFromGroup(group: string | undefined): string | null {
  if (!group?.startsWith("service:")) return null;
  return group.slice("service:".length);
}

function toContainer(container: Container): EcsContainer {
  return {
    name: container.name ?? "-",
    arn: container.containerArn ?? "",
    runtimeId: container.runtimeId ?? null,
    image: container.image ?? null,
    imageDigest: container.imageDigest ?? null,
    lastStatus: container.lastStatus ?? "UNKNOWN",
    health: container.healthStatus ?? "UNKNOWN",
    exitCode: container.exitCode ?? null,
    reason: container.reason ?? null,
    cpu: container.cpu ?? null,
    memory: container.memory ?? null,
    networkInterfaces: (container.networkInterfaces ?? []).map((ni) => ({
      privateIpv4Address: ni.privateIpv4Address ?? null,
      attachmentId: ni.attachmentId ?? null,
    })),
  };
}
