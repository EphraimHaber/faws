import type { RestApiMethodSetting, RestApiStage } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import {
  executionLogGroup,
  executionLoggingOn,
  invokeUrl,
  logGroupFromArn,
  stagesByDeployment,
} from "./stages.ts";

function setting(loggingLevel: string | null): RestApiMethodSetting {
  return {
    resourcePath: "*",
    httpMethod: "*",
    loggingLevel,
    dataTraceEnabled: false,
    metricsEnabled: false,
    throttlingBurstLimit: null,
    throttlingRateLimit: null,
    cachingEnabled: false,
    cacheTtlSeconds: null,
    cacheDataEncrypted: false,
  };
}

function stage(name: string, extra: Partial<RestApiStage> = {}): RestApiStage {
  return {
    name,
    deploymentId: null,
    description: null,
    createdAt: null,
    updatedAt: null,
    variables: {},
    cacheClusterEnabled: false,
    cacheClusterSize: null,
    cacheClusterStatus: null,
    tracingEnabled: false,
    webAclArn: null,
    clientCertificateId: null,
    documentationVersion: null,
    accessLog: null,
    canary: null,
    methodSettings: [],
    tags: {},
    ...extra,
  };
}

describe("invokeUrl", () => {
  it("builds the execute-api URL of a stage", () => {
    expect(invokeUrl("a1b2c3d4e5", "eu-west-1", "prod")).toBe(
      "https://a1b2c3d4e5.execute-api.eu-west-1.amazonaws.com/prod",
    );
  });

  it("uses the China domain in a China region", () => {
    expect(invokeUrl("a1b2c3d4e5", "cn-north-1", "prod")).toBe(
      "https://a1b2c3d4e5.execute-api.cn-north-1.amazonaws.com.cn/prod",
    );
  });
});

describe("executionLogGroup", () => {
  it("names the group API Gateway writes to", () => {
    expect(executionLogGroup("a1b2c3d4e5", "prod")).toBe(
      "API-Gateway-Execution-Logs_a1b2c3d4e5/prod",
    );
  });
});

describe("logGroupFromArn", () => {
  it("reads a log group ARN", () => {
    expect(
      logGroupFromArn("arn:aws:logs:eu-west-1:123456789012:log-group:/aws/api/access"),
    ).toEqual({ region: "eu-west-1", name: "/aws/api/access" });
  });

  it("drops a trailing wildcard", () => {
    expect(logGroupFromArn("arn:aws:logs:eu-west-1:123456789012:log-group:access:*")).toEqual({
      region: "eu-west-1",
      name: "access",
    });
  });

  it("reads a log group in another partition", () => {
    expect(logGroupFromArn("arn:aws-cn:logs:cn-north-1:123456789012:log-group:access")?.name).toBe(
      "access",
    );
  });

  it("rejects what is not a log group", () => {
    expect(
      logGroupFromArn(
        "arn:aws:firehose:eu-west-1:123456789012:deliverystream/amazon-apigateway-access",
      ),
    ).toBeNull();
    expect(logGroupFromArn("arn:aws:logs:eu-west-1:123456789012:destination:x")).toBeNull();
    expect(logGroupFromArn("arn:aws:logs:eu-west-1:123456789012:log-group:")).toBeNull();
    expect(logGroupFromArn("not an arn")).toBeNull();
  });
});

describe("executionLoggingOn", () => {
  it("is on when any setting logs errors or more", () => {
    expect(executionLoggingOn(stage("prod", { methodSettings: [setting("ERROR")] }))).toBe(true);
    expect(
      executionLoggingOn(stage("prod", { methodSettings: [setting("OFF"), setting("INFO")] })),
    ).toBe(true);
  });

  it("is off with no settings, or with logging off or unset", () => {
    expect(executionLoggingOn(stage("prod"))).toBe(false);
    expect(
      executionLoggingOn(stage("prod", { methodSettings: [setting("OFF"), setting(null)] })),
    ).toBe(false);
  });
});

describe("stagesByDeployment", () => {
  it("lists each deployment's stages, canaries marked", () => {
    const uses = stagesByDeployment([
      stage("prod", { deploymentId: "d1", canary: { ...canary(), deploymentId: "d2" } }),
      stage("beta", { deploymentId: "d2" }),
      stage("dev"),
    ]);
    expect(uses.get("d1")).toEqual([{ stage: "prod", canary: false }]);
    expect(uses.get("d2")).toEqual([
      { stage: "beta", canary: false },
      { stage: "prod", canary: true },
    ]);
    expect(uses.size).toBe(2);
  });
});

function canary(): NonNullable<RestApiStage["canary"]> {
  return {
    percentTraffic: 10,
    deploymentId: null,
    stageVariableOverrides: {},
    useStageCache: false,
  };
}
