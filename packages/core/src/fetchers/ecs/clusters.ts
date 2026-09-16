import { DescribeClustersCommand, ListClustersCommand, type Cluster } from "@aws-sdk/client-ecs";
import type { AwsScope, EcsCluster } from "@faws/contracts";
import { arnTail } from "@faws/shared";

import { callAws, chunk, collectPages, ecsClient } from "../../clients.ts";

export async function listClusters(scope: AwsScope): Promise<EcsCluster[]> {
  const client = ecsClient(scope);

  const arns = await collectPages<string>(async (nextToken) => {
    const page = await callAws("ecs", () =>
      client.send(new ListClustersCommand(nextToken ? { nextToken } : {})),
    );
    return {
      items: page.clusterArns ?? [],
      ...(page.nextToken ? { nextToken: page.nextToken } : {}),
    };
  });
  if (arns.length === 0) return [];

  const described: Cluster[] = [];
  for (const batch of chunk(arns, 100)) {
    const page = await callAws("ecs", () =>
      client.send(
        new DescribeClustersCommand({
          clusters: batch,
          include: ["SETTINGS", "STATISTICS", "TAGS"],
        }),
      ),
    );
    described.push(...(page.clusters ?? []));
  }

  return described.map(toCluster).toSorted((a, b) => a.name.localeCompare(b.name));
}

function toCluster(cluster: Cluster): EcsCluster {
  const insights = cluster.settings?.find((s) => s.name === "containerInsights")?.value;
  return {
    name: cluster.clusterName ?? arnTail(cluster.clusterArn),
    arn: cluster.clusterArn ?? "",
    status: cluster.status ?? "UNKNOWN",
    runningTasks: cluster.runningTasksCount ?? 0,
    pendingTasks: cluster.pendingTasksCount ?? 0,
    activeServices: cluster.activeServicesCount ?? 0,
    registeredInstances: cluster.registeredContainerInstancesCount ?? 0,
    capacityProviders: cluster.capacityProviders ?? [],
    containerInsights: insights === "enabled" || insights === "enhanced",
    tags: Object.fromEntries((cluster.tags ?? []).map((t) => [t.key ?? "", t.value ?? ""])),
  };
}
