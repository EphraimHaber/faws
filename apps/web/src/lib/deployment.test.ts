import type { EcsService } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { DEPLOYED_LINGER_MS, deployedUntil } from "./deployment.ts";

function service(overrides: Partial<EcsService>): EcsService {
  return {
    name: "api",
    arn: "arn:aws:ecs:us-east-1:1:service/main/api",
    clusterName: "main",
    status: "ACTIVE",
    launchType: "FARGATE",
    schedulingStrategy: "REPLICA",
    desiredCount: 2,
    runningCount: 2,
    pendingCount: 0,
    taskDefinition: "api:7",
    taskDefinitionFamily: "api",
    taskDefinitionRevision: 7,
    platformVersion: null,
    deploymentState: "steady",
    activeDeployments: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastDeploymentAt: "2026-09-24T10:00:00.000Z",
    lastDeploymentUpdatedAt: "2026-09-24T10:04:00.000Z",
    rolloutState: "COMPLETED",
    rolloutStateReason: null,
    failedTasks: 0,
    steadySince: "2026-09-24T10:04:00.000Z",
    loadBalancers: [],
    enableExecuteCommand: false,
    circuitBreaker: null,
    minimumHealthyPercent: null,
    maximumPercent: null,
    tags: {},
    ...overrides,
  };
}

describe("deployedUntil", () => {
  it("keeps a finished rollout on screen for the linger window after it settles", () => {
    expect(deployedUntil(service({}))).toBe(
      Date.parse("2026-09-24T10:04:00.000Z") + DEPLOYED_LINGER_MS,
    );
  });

  it("ignores a service that is still rolling out", () => {
    expect(
      deployedUntil(
        service({ deploymentState: "deploying", rolloutState: "IN_PROGRESS", steadySince: null }),
      ),
    ).toBeNull();
  });

  it("treats a settle long after the deployment started as a scale, not a rollout", () => {
    expect(deployedUntil(service({ lastDeploymentAt: "2026-09-01T00:00:00.000Z" }))).toBeNull();
  });
});
