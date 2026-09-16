import {
  DescribeTaskDefinitionCommand,
  ListTaskDefinitionFamiliesCommand,
  ListTaskDefinitionsCommand,
  type TaskDefinition,
} from "@aws-sdk/client-ecs";
import type {
  AwsScope,
  ContainerLogConfig,
  EcsTaskDefinitionDocument,
  EcsTaskDefinitionSummary,
} from "@faws/contracts";
import { arnTail, toIso } from "@faws/shared";

import { callAws, collectPages, ecsClient } from "../../clients.ts";
import { containerLogConfigs } from "../cloudwatch/logs.ts";

export async function listTaskDefinitionFamilies(scope: AwsScope): Promise<string[]> {
  const client = ecsClient(scope);
  return collectPages<string>(async (nextToken) => {
    const page = await callAws("ecs", () =>
      client.send(
        new ListTaskDefinitionFamiliesCommand({
          status: "ACTIVE",
          ...(nextToken ? { nextToken } : {}),
        }),
      ),
    );
    return { items: page.families ?? [], ...(page.nextToken ? { nextToken: page.nextToken } : {}) };
  });
}

/** Revision ARNs for one family, newest first. */
export async function listTaskDefinitionRevisions(
  scope: AwsScope,
  family: string,
): Promise<string[]> {
  const client = ecsClient(scope);
  const page = await callAws("ecs", () =>
    client.send(
      new ListTaskDefinitionsCommand({
        familyPrefix: family,
        sort: "DESC",
        maxResults: 100,
      }),
    ),
  );
  return page.taskDefinitionArns ?? [];
}

/** Log wiring for every container in a task definition. */
export async function taskDefinitionLogConfigs(
  scope: AwsScope,
  taskDefinition: string,
): Promise<ContainerLogConfig[]> {
  const client = ecsClient(scope);
  const page = await callAws("ecs", () =>
    client.send(new DescribeTaskDefinitionCommand({ taskDefinition })),
  );
  return containerLogConfigs(page.taskDefinition?.containerDefinitions ?? []);
}

export async function getTaskDefinition(
  scope: AwsScope,
  taskDefinition: string,
): Promise<{ summary: EcsTaskDefinitionSummary; document: EcsTaskDefinitionDocument } | null> {
  const client = ecsClient(scope);
  const page = await callAws("ecs", () =>
    client.send(new DescribeTaskDefinitionCommand({ taskDefinition })),
  );
  const raw = page.taskDefinition;
  if (!raw) return null;
  return { summary: toSummary(raw), document: raw as EcsTaskDefinitionDocument };
}

function toSummary(td: TaskDefinition): EcsTaskDefinitionSummary {
  return {
    family: td.family ?? arnTail(td.taskDefinitionArn),
    revision: td.revision ?? 0,
    arn: td.taskDefinitionArn ?? "",
    status: td.status ?? "UNKNOWN",
    cpu: td.cpu ?? null,
    memory: td.memory ?? null,
    networkMode: td.networkMode ?? null,
    requiresCompatibilities: td.requiresCompatibilities ?? [],
    registeredAt: toIso(td.registeredAt),
    containerNames: (td.containerDefinitions ?? []).map((c) => c.name ?? "-"),
  };
}
