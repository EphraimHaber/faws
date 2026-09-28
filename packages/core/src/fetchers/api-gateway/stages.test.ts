import { describe, expect, it } from "vitest";

import { methodSettingTarget, restApiStage } from "./stages.ts";

describe("methodSettingTarget", () => {
  it("reads the stage wide key", () => {
    expect(methodSettingTarget("*/*")).toEqual({ resourcePath: "*", httpMethod: "*" });
  });

  it("unescapes a path's own slashes and splits off the method", () => {
    expect(methodSettingTarget("~1orders~1{id}/GET")).toEqual({
      resourcePath: "/orders/{id}",
      httpMethod: "GET",
    });
  });

  it("reads a path written without its escapes or leading slash", () => {
    expect(methodSettingTarget("orders/POST")).toEqual({
      resourcePath: "/orders",
      httpMethod: "POST",
    });
  });

  it("reads the root path", () => {
    expect(methodSettingTarget("~1/GET")).toEqual({ resourcePath: "/", httpMethod: "GET" });
    expect(methodSettingTarget("/GET")).toEqual({ resourcePath: "/", httpMethod: "GET" });
  });
});

describe("restApiStage", () => {
  it("reads a stage with its settings, canary and access log", () => {
    const stage = restApiStage({
      stageName: "prod",
      deploymentId: "dep1",
      description: "",
      createdDate: new Date("2026-01-02T03:04:05Z"),
      lastUpdatedDate: new Date("2026-02-03T04:05:06Z"),
      variables: { table: "orders" },
      cacheClusterEnabled: true,
      cacheClusterSize: "0.5",
      cacheClusterStatus: "AVAILABLE",
      tracingEnabled: true,
      accessLogSettings: {
        destinationArn: "arn:aws:logs:eu-west-1:123456789012:log-group:access",
        format: "$context.requestId",
      },
      canarySettings: { percentTraffic: 10, deploymentId: "dep2" },
      methodSettings: {
        "~1orders/GET": { cachingEnabled: true, cacheTtlInSeconds: 60 },
        "*/*": { loggingLevel: "INFO", metricsEnabled: true, throttlingRateLimit: 100 },
      },
    });

    expect(stage).toMatchObject({
      name: "prod",
      deploymentId: "dep1",
      description: null,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-02-03T04:05:06.000Z",
      variables: { table: "orders" },
      cacheClusterEnabled: true,
      cacheClusterSize: "0.5",
      tracingEnabled: true,
      webAclArn: null,
      accessLog: {
        destinationArn: "arn:aws:logs:eu-west-1:123456789012:log-group:access",
        format: "$context.requestId",
      },
      canary: {
        percentTraffic: 10,
        deploymentId: "dep2",
        stageVariableOverrides: {},
        useStageCache: false,
      },
    });
    expect(stage?.methodSettings.map((s) => `${s.resourcePath} ${s.httpMethod}`)).toEqual([
      "* *",
      "/orders GET",
    ]);
    expect(stage?.methodSettings[0]).toMatchObject({
      loggingLevel: "INFO",
      metricsEnabled: true,
      throttlingRateLimit: 100,
      throttlingBurstLimit: null,
      cachingEnabled: false,
    });
  });

  it("reads a bare stage", () => {
    expect(restApiStage({ stageName: "dev" })).toMatchObject({
      accessLog: null,
      canary: null,
      methodSettings: [],
      cacheClusterEnabled: false,
    });
  });

  it("drops a stage without a name", () => {
    expect(restApiStage({ deploymentId: "dep1" })).toBeNull();
  });
});
