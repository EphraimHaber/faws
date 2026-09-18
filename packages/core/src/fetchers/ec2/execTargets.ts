/**
 * Instances you could open a shell on.
 *
 * Two APIs, joined here rather than in the UI. DescribeInstances knows an
 * instance exists and whether it has a public address;
 * DescribeInstanceInformation knows whether the SSM agent is registered and
 * answering. Neither one answers "can I get a shell on this", so the join and
 * the ranking live in one place and every caller gets the same answer.
 *
 * Both calls are made even when one fails: a missing ssm:DescribeInstanceInformation
 * permission is common and should degrade to "SSH only" rather than emptying
 * the list.
 */
import { DescribeInstancesCommand, type Instance } from "@aws-sdk/client-ec2";
import { DescribeInstanceInformationCommand } from "@aws-sdk/client-ssm";
import type { AwsScope, ExecInstanceTarget } from "@faws/contracts";

import { callAws, collectPages, ec2Client, ssmClient } from "../../clients.ts";

interface SsmInfo {
  readonly pingStatus: string | null;
  readonly agentVersion: string | null;
}

async function ssmManagedInstances(scope: AwsScope): Promise<Map<string, SsmInfo>> {
  const client = ssmClient(scope);
  const found = new Map<string, SsmInfo>();

  try {
    const pages = await collectPages(async (nextToken) => {
      const page = await callAws("ssm", () =>
        client.send(
          new DescribeInstanceInformationCommand({
            MaxResults: 50,
            ...(nextToken ? { NextToken: nextToken } : {}),
          }),
        ),
      );
      return {
        items: page.InstanceInformationList ?? [],
        ...(page.NextToken ? { nextToken: page.NextToken } : {}),
      };
    });

    for (const entry of pages) {
      if (!entry.InstanceId) continue;
      found.set(entry.InstanceId, {
        pingStatus: entry.PingStatus ?? null,
        agentVersion: entry.AgentVersion ?? null,
      });
    }
  } catch {
    // Reading SSM is a separate permission from reading EC2. Losing it costs
    // the "connect by SSM" option, not the whole list.
  }

  return found;
}

function tagValue(instance: Instance, key: string): string | null {
  return instance.Tags?.find((tag) => tag.Key === key)?.Value ?? null;
}

function reachability(
  instance: Instance,
  ssm: SsmInfo | undefined,
): ExecInstanceTarget["reachableBy"] {
  if (instance.State?.Name !== "running") return [];

  const routes: Array<"ssm" | "ssh-public" | "ssh-ssm-tunnel"> = [];
  const online = ssm?.pingStatus === "Online";

  // SSM first: it needs no inbound rule, no key and no public address, so when
  // it is available it is the one most likely to just work.
  if (online) routes.push("ssm");
  if (instance.PublicIpAddress || instance.PublicDnsName) routes.push("ssh-public");
  if (online) routes.push("ssh-ssm-tunnel");
  return routes;
}

export async function listExecTargets(scope: AwsScope): Promise<ExecInstanceTarget[]> {
  const client = ec2Client(scope);

  const [instances, ssm] = await Promise.all([
    collectPages<Instance>(async (nextToken) => {
      const page = await callAws("ec2", () =>
        client.send(
          new DescribeInstancesCommand({
            // Terminated instances cannot be connected to and are noise in a
            // picker; everything else is worth showing with its state.
            Filters: [
              {
                Name: "instance-state-name",
                Values: ["running", "pending", "stopping", "stopped"],
              },
            ],
            MaxResults: 200,
            ...(nextToken ? { NextToken: nextToken } : {}),
          }),
        ),
      );
      return {
        items: (page.Reservations ?? []).flatMap((reservation) => reservation.Instances ?? []),
        ...(page.NextToken ? { nextToken: page.NextToken } : {}),
      };
    }),
    ssmManagedInstances(scope),
  ]);

  return instances
    .filter((instance): instance is Instance & { InstanceId: string } =>
      Boolean(instance.InstanceId),
    )
    .map((instance) => {
      const info = ssm.get(instance.InstanceId);
      return {
        instanceId: instance.InstanceId,
        name: tagValue(instance, "Name"),
        state: instance.State?.Name ?? "unknown",
        privateIp: instance.PrivateIpAddress ?? null,
        publicIp: instance.PublicIpAddress ?? null,
        availabilityZone: instance.Placement?.AvailabilityZone ?? null,
        platform: instance.PlatformDetails ?? null,
        instanceType: instance.InstanceType ?? null,
        vpcId: instance.VpcId ?? null,
        keyName: instance.KeyName ?? null,
        ssmManaged: info !== undefined,
        ssmPingStatus: info?.pingStatus ?? null,
        ssmAgentVersion: info?.agentVersion ?? null,
        reachableBy: reachability(instance, info),
      } satisfies ExecInstanceTarget;
    })
    .toSorted((a, b) => {
      // Connectable first, then by name - a picker should open on something
      // you can actually use.
      const byReach = Number(b.reachableBy.length > 0) - Number(a.reachableBy.length > 0);
      if (byReach !== 0) return byReach;
      return (a.name ?? a.instanceId).localeCompare(b.name ?? b.instanceId);
    });
}
