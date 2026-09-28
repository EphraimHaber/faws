import { describe, expect, it } from "vitest";

import { periodLabel, restApiDimensions } from "./metrics.ts";

describe("restApiDimensions", () => {
  it("is the name alone for every stage together", () => {
    expect(restApiDimensions("orders", null)).toEqual([{ name: "ApiName", value: "orders" }]);
    expect(restApiDimensions("orders", "")).toEqual([{ name: "ApiName", value: "orders" }]);
  });

  it("adds the stage for one stage", () => {
    expect(restApiDimensions("orders", "prod")).toEqual([
      { name: "ApiName", value: "orders" },
      { name: "Stage", value: "prod" },
    ]);
  });
});

describe("periodLabel", () => {
  it("uses the largest whole unit", () => {
    expect(periodLabel(60)).toBe("1m");
    expect(periodLabel(300)).toBe("5m");
    expect(periodLabel(3600)).toBe("1h");
    expect(periodLabel(30)).toBe("30s");
  });
});
