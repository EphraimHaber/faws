import {
  DescribeContainerInstancesCommand,
  ListContainerInstancesCommand,
  type ContainerInstance,
} from "@aws-sdk/client-ecs";
import type { AwsScope, EcsContainerInstance } from "@faws/contracts";
import { arnTail } from "@faws/shared";

import { callAws, chunk, collectPages, ecsClient } from "../../clients.ts";

export async function listContainerInstances(
  scope: AwsScope,
  cluster: string,
): Promise<EcsContainerInstance[]> {
  const client = ecsClient(scope);

  const arns = await collectPages<string>(async (nextToken) => {
    const page = await callAws("ecs", () =>
      client.send(
        new ListContainerInstancesCommand({ cluster, ...(nextToken ? { nextToken } : {}) }),
      ),
    );
    return {
      items: page.containerInstanceArns ?? [],
      ...(page.nextToken ? { nextToken: page.nextToken } : {}),
    };
  });
  if (arns.length === 0) return [];

  const described: ContainerInstance[] = [];
  for (const batch of chunk(arns, 100)) {
    const page = await callAws("ecs", () =>
      client.send(new DescribeContainerInstancesCommand({ cluster, containerInstances: batch })),
    );
    described.push(...(page.containerInstances ?? []));
  }

  return described.map(toContainerInstance);
}

function toContainerInstance(instance: ContainerInstance): EcsContainerInstance {
  const registered = (name: string) =>
    instance.registeredResources?.find((r) => r.name === name)?.integerValue ?? null;
  const remaining = (name: string) =>
    instance.remainingResources?.find((r) => r.name === name)?.integerValue ?? null;

  return {
    id: arnTail(instance.containerInstanceArn),
    arn: instance.containerInstanceArn ?? "",
    ec2InstanceId: instance.ec2InstanceId ?? null,
    status: instance.status ?? "UNKNOWN",
    agentConnected: instance.agentConnected ?? false,
    agentVersion: instance.versionInfo?.agentVersion ?? null,
    runningTasks: instance.runningTasksCount ?? 0,
    pendingTasks: instance.pendingTasksCount ?? 0,
    registeredCpu: registered("CPU"),
    remainingCpu: remaining("CPU"),
    registeredMemory: registered("MEMORY"),
    remainingMemory: remaining("MEMORY"),
    capacityProvider: instance.capacityProviderName ?? null,
  };
}
