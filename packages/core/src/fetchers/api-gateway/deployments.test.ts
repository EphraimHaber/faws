import { describe, expect, it } from "vitest";

import { restApiDeployment } from "./deployments.ts";

describe("restApiDeployment", () => {
  it("reads a deployment", () => {
    expect(
      restApiDeployment({
        id: "dep1",
        description: "release 12",
        createdDate: new Date("2026-01-02T03:04:05Z"),
      }),
    ).toEqual({ id: "dep1", description: "release 12", createdAt: "2026-01-02T03:04:05.000Z" });
  });

  it("reads an empty description as none, and drops a deployment without an id", () => {
    expect(restApiDeployment({ id: "dep1", description: "" })?.description).toBeNull();
    expect(restApiDeployment({ description: "orphan" })).toBeNull();
  });
});
