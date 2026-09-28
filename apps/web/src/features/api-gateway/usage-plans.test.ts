import type { UsagePlan } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { limitsLabel, plansForStage, quotaLabel } from "./usage-plans";

function plan(id: string, stages: [string, string][]): UsagePlan {
  return {
    id,
    name: id,
    description: null,
    throttle: null,
    quota: null,
    apiStages: stages.map(([apiId, stage]) => ({ apiId, stage, methodThrottles: [] })),
    productCode: null,
    tags: {},
  };
}

describe("limitsLabel", () => {
  it("reads rate and burst, marking whichever is unset", () => {
    expect(limitsLabel({ rateLimit: 100, burstLimit: 200 })).toBe("100/s, burst 200");
    expect(limitsLabel({ rateLimit: null, burstLimit: 20 })).toBe("-/s, burst 20");
    expect(limitsLabel(null)).toBe("none");
  });
});

describe("quotaLabel", () => {
  it("reads a count per period", () => {
    expect(quotaLabel({ limit: 10000, period: "MONTH", offset: 0 })).toBe("10,000 a month");
    expect(quotaLabel({ limit: 50, period: null, offset: null })).toBe("50");
    expect(quotaLabel(null)).toBe("none");
  });
});

describe("plansForStage", () => {
  it("keeps the plans naming this API and stage together", () => {
    const plans = [
      plan("gold", [
        ["a1", "prod"],
        ["b2", "prod"],
      ]),
      plan("free", [["a1", "dev"]]),
      plan("other", [["b2", "prod"]]),
    ];
    expect(
      plansForStage(plans, "a1", "prod").map(({ plan, apiStage }) => [plan.id, apiStage.apiId]),
    ).toEqual([["gold", "a1"]]);
    expect(plansForStage(plans, "a1", "staging")).toEqual([]);
  });
});
