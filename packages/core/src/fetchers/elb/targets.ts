import {
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsScope, EcsService, TargetGroupHealth, TargetHealth } from "@faws/contracts";
import { arnTail } from "@faws/shared";

import { callAws } from "../../clients.ts";

const clients = new Map<string, ElasticLoadBalancingV2Client>();

function elbClient(scope: AwsScope): ElasticLoadBalancingV2Client {
  const key = `${scope.profile}::${scope.region}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new ElasticLoadBalancingV2Client({
    region: scope.region,
    credentials: fromNodeProviderChain(scope.profile ? { profile: scope.profile } : {}),
  });
  clients.set(key, client);
  return client;
}

/**
 * Health of every target group the service registers into, with the health
 * check settings that explain how long "initial" will last.
 */
export async function serviceTargetHealth(
  scope: AwsScope,
  service: Pick<EcsService, "loadBalancers">,
): Promise<TargetGroupHealth[]> {
  const registrations = service.loadBalancers.filter((lb) => lb.targetGroupArn);
  if (registrations.length === 0) return [];

  const client = elbClient(scope);
  const arns = registrations.map((lb) => lb.targetGroupArn!);

  const described = await callAws("elbv2", () =>
    client.send(new DescribeTargetGroupsCommand({ TargetGroupArns: arns })),
  );
  const byArn = new Map(
    (described.TargetGroups ?? []).map((group) => [group.TargetGroupArn ?? "", group]),
  );

  return Promise.all(
    registrations.map(async (registration): Promise<TargetGroupHealth> => {
      const arn = registration.targetGroupArn!;
      const group = byArn.get(arn);
      const health = await callAws("elbv2", () =>
        client.send(new DescribeTargetHealthCommand({ TargetGroupArn: arn })),
      );

      const targets = (health.TargetHealthDescriptions ?? []).map((entry): TargetHealth => ({
        targetId: entry.Target?.Id ?? "-",
        port: entry.Target?.Port ?? null,
        availabilityZone: entry.Target?.AvailabilityZone ?? null,
        state: entry.TargetHealth?.State ?? "unknown",
        reason: entry.TargetHealth?.Reason ?? null,
        description: entry.TargetHealth?.Description ?? null,
      }));

      return {
        targetGroupArn: arn,
        targetGroupName: group?.TargetGroupName ?? arnTail(arn),
        containerName: registration.containerName,
        containerPort: registration.containerPort,
        protocol: group?.Protocol ?? null,
        healthCheckPath: group?.HealthCheckPath ?? null,
        healthCheckIntervalSeconds: group?.HealthCheckIntervalSeconds ?? null,
        healthyThresholdCount: group?.HealthyThresholdCount ?? null,
        unhealthyThresholdCount: group?.UnhealthyThresholdCount ?? null,
        targets,
      };
    }),
  );
}
