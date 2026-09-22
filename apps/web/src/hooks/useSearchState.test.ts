import { describe, expect, it } from "vitest";

import { parseSelection, parseText, serializeSelection } from "./useSearchState.ts";

/**
 * The hook itself needs a router; these are the parts that decide what a URL
 * means, which are the parts worth pinning down.
 */

describe("parseText", () => {
  it("passes a string through", () => {
    expect(parseText("prod")).toBe("prod");
  });

  it("reads anything else as absent", () => {
    // The route's own schema catches to undefined; this is the second line.
    expect(parseText(undefined)).toBe("");
    expect(parseText(42)).toBe("");
    expect(parseText(["a"])).toBe("");
  });
});

describe("parseSelection", () => {
  it("splits on commas", () => {
    expect(parseSelection("a,b,c")).toEqual(new Set(["a", "b", "c"]));
  });

  it("is empty for an absent or empty param", () => {
    expect(parseSelection(undefined)).toEqual(new Set());
    expect(parseSelection("")).toEqual(new Set());
  });

  it("drops empty entries rather than selecting nothing-named", () => {
    expect(parseSelection("a,,b,")).toEqual(new Set(["a", "b"]));
  });
});

describe("serializeSelection", () => {
  it("removes the param when nothing is ticked", () => {
    expect(serializeSelection(new Set())).toBeUndefined();
  });

  it("gives one URL per selection however it was built", () => {
    expect(serializeSelection(new Set(["b", "a"]))).toBe(serializeSelection(new Set(["a", "b"])));
  });

  it("round-trips through parse", () => {
    const selected = new Set(["arn:aws:s3:::one", "arn:aws:s3:::two"]);
    expect(parseSelection(serializeSelection(selected))).toEqual(selected);
  });
});
