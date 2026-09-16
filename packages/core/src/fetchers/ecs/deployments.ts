import {
  DescribeServiceDeploymentsCommand,
  DescribeServiceRevisionsCommand,
  ListServiceDeploymentsCommand,
  type ServiceDeployment,
  type ServiceRevisionSummary,
} from "@aws-sdk/client-ecs";
import type { AwsScope, ServiceDeploymentRecord, ServiceRevisionCounts } from "@faws/contracts";
import { arnTail, taskDefinitionLabel, toIso } from "@faws/shared";

import { callAws, chunk, collectPages, ecsClient } from "../../clients.ts";

/**
 * Deployment history for a service.
 *
 * `DescribeServices` only returns deployments that are still active, so
 * anything that finished is invisible to it. `ListServiceDeployments` is the
 * API that remembers, and its detail view carries things the live view can
 * only infer: the circuit breaker's real threshold and failure count, the
 * CloudWatch alarms wired as rollback monitors, and the reason a rollback
 * started.
 */
export async function serviceDeploymentHistory(
  scope: AwsScope,
  cluster: string,
  service: string,
  limit = 20,
): Promise<ServiceDeploymentRecord[]> {
  const client = ecsClient(scope);

  const arns = await collectPages<string>(async (nextToken) => {
    const page = await callAws("ecs", () =>
      client.send(
        new ListServiceDeploymentsCommand({
          cluster,
          service,
          ...(nextToken ? { nextToken } : {}),
        }),
      ),
    );
    return {
      items: (page.serviceDeployments ?? [])
        .map((entry) => entry.serviceDeploymentArn)
        .filter((arn): arn is string => Boolean(arn)),
      ...(page.nextToken ? { nextToken: page.nextToken } : {}),
    };
  });
  if (arns.length === 0) return [];

  // Newest first, and only as deep as the UI will show.
  const wanted = arns.slice(0, limit);

  const described: ServiceDeployment[] = [];
  // DescribeServiceDeployments accepts at most 20 ARNs per call.
  for (const batch of chunk(wanted, 20)) {
    const page = await callAws("ecs", () =>
      client.send(new DescribeServiceDeploymentsCommand({ serviceDeploymentArns: batch })),
    );
    described.push(...(page.serviceDeployments ?? []));
  }

  const revisionLabels = await resolveRevisionLabels(scope, described);

  return described
    .map((deployment) => toRecord(deployment, revisionLabels))
    .toSorted((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * Service revisions are opaque ARNs; the task definition behind each one is
 * what an operator actually recognises, so they are resolved in one batch.
 */
async function resolveRevisionLabels(
  scope: AwsScope,
  deployments: ReadonlyArray<ServiceDeployment>,
): Promise<Map<string, string>> {
  const arns = new Set<string>();
  for (const deployment of deployments) {
    for (const revision of deployment.sourceServiceRevisions ?? []) {
      if (revision.arn) arns.add(revision.arn);
    }
    if (deployment.targetServiceRevision?.arn) arns.add(deployment.targetServiceRevision.arn);
    if (deployment.rollback?.serviceRevisionArn) arns.add(deployment.rollback.serviceRevisionArn);
  }
  if (arns.size === 0) return new Map();

  const client = ecsClient(scope);
  const labels = new Map<string, string>();
  for (const batch of chunk([...arns], 20)) {
    try {
      const page = await callAws("ecs", () =>
        client.send(new DescribeServiceRevisionsCommand({ serviceRevisionArns: batch })),
      );
      for (const revision of page.serviceRevisions ?? []) {
        if (revision.serviceRevisionArn && revision.taskDefinition) {
          labels.set(revision.serviceRevisionArn, taskDefinitionLabel(revision.taskDefinition));
        }
      }
    } catch {
      // Labels are a nicety; a deployment list is still useful without them.
    }
  }
  return labels;
}

function toRecord(
  deployment: ServiceDeployment,
  labels: Map<string, string>,
): ServiceDeploymentRecord {
  const started = deployment.startedAt ?? deployment.createdAt;
  const ended = deployment.finishedAt ?? deployment.stoppedAt;
  const durationSeconds = started
    ? Math.max(0, Math.round(((ended ? ended.getTime() : Date.now()) - started.getTime()) / 1000))
    : null;

  const toCounts = (revision: ServiceRevisionSummary): ServiceRevisionCounts => ({
    arn: revision.arn ?? "",
    taskDefinition: revision.arn ? (labels.get(revision.arn) ?? null) : null,
    requestedCount: revision.requestedTaskCount ?? null,
    runningCount: revision.runningTaskCount ?? null,
    pendingCount: revision.pendingTaskCount ?? null,
  });

  const breaker = deployment.deploymentCircuitBreaker;
  const alarms = deployment.alarms;
  const rollback = deployment.rollback;

  return {
    arn: deployment.serviceDeploymentArn ?? "",
    id: arnTail(deployment.serviceDeploymentArn),
    status: deployment.status ?? "UNKNOWN",
    statusReason: deployment.statusReason ?? null,
    lifecycleStage: deployment.lifecycleStage ?? null,
    createdAt: toIso(deployment.createdAt),
    startedAt: toIso(deployment.startedAt),
    finishedAt: toIso(deployment.finishedAt),
    stoppedAt: toIso(deployment.stoppedAt),
    updatedAt: toIso(deployment.updatedAt),
    durationSeconds,
    source: (deployment.sourceServiceRevisions ?? []).map(toCounts),
    target: deployment.targetServiceRevision ? toCounts(deployment.targetServiceRevision) : null,
    circuitBreaker: breaker
      ? {
          status: breaker.status ?? null,
          failureCount: breaker.failureCount ?? null,
          threshold: breaker.threshold ?? null,
        }
      : null,
    alarms: alarms
      ? {
          status: alarms.status ?? null,
          alarmNames: alarms.alarmNames ?? [],
          triggeredAlarmNames: alarms.triggeredAlarmNames ?? [],
        }
      : null,
    rollback: rollback
      ? {
          reason: rollback.reason ?? null,
          startedAt: toIso(rollback.startedAt),
          serviceRevisionArn: rollback.serviceRevisionArn ?? null,
          taskDefinition: rollback.serviceRevisionArn
            ? (labels.get(rollback.serviceRevisionArn) ?? null)
            : null,
        }
      : null,
  };
}
