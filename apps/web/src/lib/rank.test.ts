import { describe, expect, it } from "vitest";

import { isSubsequence, rankBy, scoreMatch } from "./rank.ts";

/** Ordering is what this module exists for, so most assertions are about it. */
function order(items: readonly string[], needle: string): string[] {
  return rankBy(items, needle, (item) => [item]);
}

describe("scoreMatch", () => {
  it("scores an empty query as zero rather than no match", () => {
    expect(scoreMatch("anything", "")).toBe(0);
    expect(scoreMatch("anything", "   ")).toBe(0);
  });

  it("returns null when the letters are not there in order", () => {
    expect(scoreMatch("instances", "zzz")).toBeNull();
    expect(scoreMatch("api-service", "vsa")).toBeNull();
  });

  it("ignores case on both sides", () => {
    expect(scoreMatch("Instances", "INST")).not.toBeNull();
  });

  it("ranks exact above prefix above word start above substring", () => {
    const exact = scoreMatch("api", "api");
    const prefix = scoreMatch("api-service", "api");
    const word = scoreMatch("web-api-service", "api");
    const substring = scoreMatch("rapid", "api");

    expect(exact).toBeGreaterThan(prefix!);
    expect(prefix).toBeGreaterThan(word!);
    expect(word).toBeGreaterThan(substring!);
  });

  it("ranks any substring above a mere subsequence", () => {
    expect(scoreMatch("rapid", "api")).toBeGreaterThan(scoreMatch("a-p-i", "api")!);
  });

  it("prefers the shorter of two haystacks in the same tier", () => {
    expect(scoreMatch("api-svc", "api")).toBeGreaterThan(scoreMatch("api-service-long", "api")!);
  });

  it("never lets the length bonus cross a tier", () => {
    // A very short substring match still loses to a very long prefix match.
    expect(scoreMatch("xapi", "api")).toBeLessThan(scoreMatch("api".padEnd(200, "x"), "api")!);
  });
});

describe("rankBy", () => {
  it("puts the obvious answer first regardless of input order", () => {
    // The bug this module fixes: insertion order used to decide this.
    expect(order(["invoice-ingest", "notification-stack", "Instances"], "inst")[0]).toBe(
      "Instances",
    );
  });

  it("keeps subsequence matches, just below better ones", () => {
    expect(order(["api-service", "a-p-i"], "api")).toEqual(["api-service", "a-p-i"]);
  });

  it("drops items nothing matches", () => {
    expect(order(["alpha", "beta"], "zzz")).toEqual([]);
  });

  it("scores an item by its best text, not its first", () => {
    const items = [
      { label: "Buckets", hint: "storage" },
      { label: "Something", hint: "buckets live here" },
    ];
    const ranked = rankBy(items, "buckets", (item) => [item.label, item.hint]);
    expect(ranked[0]?.label).toBe("Buckets");
  });

  it("returns everything in the given order for an empty query", () => {
    expect(order(["c", "a", "b"], "")).toEqual(["c", "a", "b"]);
  });

  it("lets a boost settle a tie without overturning the ladder", () => {
    const items = ["api-two", "api-one"];
    const boosted = rankBy(
      items,
      "api",
      (item) => [item],
      (item) => (item === "api-one" ? 50 : 0),
    );
    expect(boosted[0]).toBe("api-one");

    // But a boost cannot lift a subsequence match over a prefix match.
    const across = rankBy(
      ["api-service", "a-p-i"],
      "api",
      (item) => [item],
      (item) => (item === "a-p-i" ? 50 : 0),
    );
    expect(across[0]).toBe("api-service");
  });
});

describe("isSubsequence", () => {
  it("matches letters in order", () => {
    expect(isSubsequence("api-service", "apsv")).toBe(true);
  });

  it("rejects letters out of order", () => {
    expect(isSubsequence("api-service", "vpa")).toBe(false);
  });
});
