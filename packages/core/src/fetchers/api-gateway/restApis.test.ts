import { describe, expect, it } from "vitest";

import { restApiSummary } from "./restApis.ts";

describe("restApiSummary", () => {
  it("reads what the list shows", () => {
    expect(
      restApiSummary({
        id: "a1b2c3d4e5",
        name: "orders",
        description: "Order intake",
        createdDate: new Date("2026-01-02T03:04:05.000Z"),
        version: "v2",
        endpointConfiguration: { types: ["REGIONAL"] },
        apiKeySource: "HEADER",
      }),
    ).toEqual({
      id: "a1b2c3d4e5",
      name: "orders",
      description: "Order intake",
      createdAt: "2026-01-02T03:04:05.000Z",
      version: "v2",
      endpointTypes: ["REGIONAL"],
      apiKeySource: "HEADER",
    });
  });

  it("treats an empty description or version as none", () => {
    const summary = restApiSummary({ id: "a1", name: "x", description: "", version: "" });
    expect(summary?.description).toBeNull();
    expect(summary?.version).toBeNull();
  });

  it("names an unnamed API by its id", () => {
    expect(restApiSummary({ id: "a1" })?.name).toBe("a1");
    expect(restApiSummary({ id: "a1" })?.endpointTypes).toEqual([]);
  });

  it("skips an API without an id", () => {
    expect(restApiSummary({ name: "ghost" })).toBeNull();
  });
});
