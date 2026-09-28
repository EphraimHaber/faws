import { describe, expect, it } from "vitest";

import { throttleLimits, usagePlan, usagePlanKey, usagePlanQuota } from "./usagePlans.ts";

describe("usagePlan", () => {
  it("reads a plan with a throttle, a quota and a stage with method throttles", () => {
    expect(
      usagePlan({
        id: "plan1",
        name: "Gold",
        description: "Paying customers",
        throttle: { rateLimit: 100, burstLimit: 200 },
        quota: { limit: 10000, period: "MONTH", offset: 0 },
        apiStages: [
          {
            apiId: "a1b2c3",
            stage: "prod",
            throttle: {
              "/pets/POST": { rateLimit: 5, burstLimit: 10 },
              "/orders/{id}/GET": { rateLimit: 50 },
              "/pets/GET": { rateLimit: 20, burstLimit: 40 },
            },
          },
        ],
        tags: { team: "payments" },
      }),
    ).toEqual({
      id: "plan1",
      name: "Gold",
      description: "Paying customers",
      throttle: { rateLimit: 100, burstLimit: 200 },
      quota: { limit: 10000, period: "MONTH", offset: 0 },
      apiStages: [
        {
          apiId: "a1b2c3",
          stage: "prod",
          methodThrottles: [
            {
              resourcePath: "/orders/{id}",
              httpMethod: "GET",
              throttle: { rateLimit: 50, burstLimit: null },
            },
            {
              resourcePath: "/pets",
              httpMethod: "GET",
              throttle: { rateLimit: 20, burstLimit: 40 },
            },
            {
              resourcePath: "/pets",
              httpMethod: "POST",
              throttle: { rateLimit: 5, burstLimit: 10 },
            },
          ],
        },
      ],
      productCode: null,
      tags: { team: "payments" },
    });
  });

  it("reads a bare plan, dropping stages missing their API or stage", () => {
    expect(usagePlan({ id: "plan2", apiStages: [{ apiId: "a1b2c3" }, { stage: "prod" }] })).toEqual(
      {
        id: "plan2",
        name: "plan2",
        description: null,
        throttle: null,
        quota: null,
        apiStages: [],
        productCode: null,
        tags: {},
      },
    );
  });

  it("drops a plan without an id", () => {
    expect(usagePlan({ name: "orphan" })).toBeNull();
  });
});

describe("throttleLimits", () => {
  it("keeps whichever limit is set, and reads neither as no throttle", () => {
    expect(throttleLimits({ burstLimit: 10 })).toEqual({ rateLimit: null, burstLimit: 10 });
    expect(throttleLimits({})).toBeNull();
    expect(throttleLimits(undefined)).toBeNull();
  });
});

describe("usagePlanQuota", () => {
  it("reads a quota without a limit as no quota", () => {
    expect(usagePlanQuota({ period: "DAY" })).toBeNull();
    expect(usagePlanQuota({ limit: 500, period: "DAY" })).toEqual({
      limit: 500,
      period: "DAY",
      offset: null,
    });
  });
});

describe("usagePlanKey", () => {
  it("drops the value AWS sends with the key", () => {
    const key = usagePlanKey({ id: "k1", name: "acme", type: "API_KEY", value: "secret" });
    expect(key).toEqual({ id: "k1", name: "acme", type: "API_KEY" });
    expect(JSON.stringify(key)).not.toContain("secret");
  });

  it("drops a key without an id", () => {
    expect(usagePlanKey({ name: "acme" })).toBeNull();
  });
});
