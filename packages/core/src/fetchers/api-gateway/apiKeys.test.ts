import { describe, expect, it } from "vitest";

import { apiKey, stageKeyTarget } from "./apiKeys.ts";

describe("apiKey", () => {
  it("reads a key, splitting its stage keys", () => {
    expect(
      apiKey({
        id: "k1",
        name: "acme",
        description: "Acme's integration",
        enabled: true,
        createdDate: new Date("2026-01-02T03:04:05Z"),
        lastUpdatedDate: new Date("2026-02-03T04:05:06Z"),
        stageKeys: ["a1b2c3/prod", "garbage"],
        tags: { customer: "acme" },
      }),
    ).toEqual({
      id: "k1",
      name: "acme",
      description: "Acme's integration",
      customerId: null,
      enabled: true,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-02-03T04:05:06.000Z",
      stageKeys: [{ apiId: "a1b2c3", stage: "prod" }],
      tags: { customer: "acme" },
    });
  });

  it("never carries a value, even when AWS sends one", () => {
    const key = apiKey({ id: "k1", value: "secret" });
    expect(key).not.toHaveProperty("value");
    expect(JSON.stringify(key)).not.toContain("secret");
  });

  it("names an unnamed key by its id, reads a missing flag as disabled, and drops one without an id", () => {
    expect(apiKey({ id: "k2" })).toMatchObject({ name: "k2", enabled: false, stageKeys: [] });
    expect(apiKey({ name: "orphan" })).toBeNull();
  });
});

describe("stageKeyTarget", () => {
  it("splits at the first slash", () => {
    expect(stageKeyTarget("a1b2c3/prod")).toEqual({ apiId: "a1b2c3", stage: "prod" });
  });

  it("rejects a key missing either half", () => {
    expect(stageKeyTarget("a1b2c3")).toBeNull();
    expect(stageKeyTarget("/prod")).toBeNull();
    expect(stageKeyTarget("a1b2c3/")).toBeNull();
  });
});
