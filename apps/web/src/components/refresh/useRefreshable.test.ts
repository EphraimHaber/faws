import { describe, expect, it } from "vitest";

import { formatAge } from "./useRefreshable";

describe("formatAge", () => {
  const now = 1_000_000_000;
  it("reads as words for the first seconds, then the largest whole unit", () => {
    expect(formatAge(now - 3_000, now)).toBe("just now");
    expect(formatAge(now - 42_000, now)).toBe("42s ago");
    expect(formatAge(now - 3 * 60_000 - 20_000, now)).toBe("3m ago");
    expect(formatAge(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(formatAge(now - 3 * 86_400_000, now)).toBe("3d ago");
  });

  it("treats a stamp from a clock running ahead as just now", () => {
    expect(formatAge(now + 5_000, now)).toBe("just now");
  });
});
