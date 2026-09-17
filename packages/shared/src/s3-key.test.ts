import { describe, expect, it } from "vitest";

import { joinKey, keyName, normalizePrefix, parentPrefix, prefixTrail } from "./s3-key.ts";

describe("keyName", () => {
  it("takes the last segment of a key", () => {
    expect(keyName("logs/2026/app.json")).toBe("app.json");
  });

  it("ignores a trailing slash, so a prefix names its own folder", () => {
    expect(keyName("logs/2026/")).toBe("2026");
  });

  it("passes a root level key through", () => {
    expect(keyName("app.json")).toBe("app.json");
  });
});

describe("parentPrefix", () => {
  it("drops the last segment and keeps the slash", () => {
    expect(parentPrefix("logs/2026/app.json")).toBe("logs/2026/");
  });

  it("climbs out of a prefix rather than returning it", () => {
    expect(parentPrefix("logs/2026/")).toBe("logs/");
  });

  it("is empty at the root", () => {
    expect(parentPrefix("app.json")).toBe("");
  });
});

describe("prefixTrail", () => {
  it("walks the root down to the prefix", () => {
    expect(prefixTrail("logs/2026/")).toEqual([
      { name: "logs", prefix: "logs/" },
      { name: "2026", prefix: "logs/2026/" },
    ]);
  });

  it("is empty at the root", () => {
    expect(prefixTrail("")).toEqual([]);
  });
});

describe("normalizePrefix", () => {
  it("adds the trailing slash a prefix needs", () => {
    expect(normalizePrefix("logs/2026")).toBe("logs/2026/");
  });

  it("drops a leading slash, which would list nothing", () => {
    expect(normalizePrefix("/logs/")).toBe("logs/");
  });

  it("collapses doubled slashes", () => {
    expect(normalizePrefix("logs//2026///")).toBe("logs/2026/");
  });

  it("leaves the root empty rather than a bare slash", () => {
    expect(normalizePrefix("")).toBe("");
    expect(normalizePrefix("/")).toBe("");
  });
});

describe("joinKey", () => {
  it("joins without doubling the separator", () => {
    expect(joinKey("logs/", "app.json")).toBe("logs/app.json");
    expect(joinKey("logs", "/app.json")).toBe("logs/app.json");
  });

  it("returns the bare name at the root", () => {
    expect(joinKey("", "app.json")).toBe("app.json");
  });
});
