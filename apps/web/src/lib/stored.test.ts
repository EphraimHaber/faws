import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { readStored, writeStored } from "./stored.ts";

// Mirrors a real preference schema: `catch` supplies the default, and the
// shape is strict enough that a coerced `null` does not slip through as 0.
const schema = z.coerce
  .number()
  .refine((n) => [10, 30, 60].includes(n))
  .catch(30);

function stubStorage(impl: Partial<Storage>): void {
  vi.stubGlobal("window", { localStorage: impl as Storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readStored", () => {
  it("parses a stored value", () => {
    stubStorage({ getItem: () => "60" });
    expect(readStored("k", schema)).toBe(60);
  });

  it("falls back when nothing is stored", () => {
    stubStorage({ getItem: () => null });
    expect(readStored("k", schema)).toBe(30);
  });

  it("falls back on a value this version no longer understands", () => {
    stubStorage({ getItem: () => "not-a-number" });
    expect(readStored("k", schema)).toBe(30);
  });

  it("falls back when storage itself throws", () => {
    stubStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readStored("k", schema)).toBe(30);
  });
});

describe("writeStored", () => {
  it("writes through to storage", () => {
    const setItem = vi.fn();
    stubStorage({ setItem });
    writeStored("k", "7");
    expect(setItem).toHaveBeenCalledWith("k", "7");
  });

  it("swallows a blocked write so the session keeps working", () => {
    stubStorage({
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => writeStored("k", "7")).not.toThrow();
  });
});
