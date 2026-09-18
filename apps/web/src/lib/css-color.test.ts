import { describe, expect, it } from "vitest";

import { parseRgbToHex } from "./css-color.ts";

describe("parseRgbToHex", () => {
  it("parses rgb()", () => {
    expect(parseRgbToHex("rgb(1, 2, 3)")).toBe("#010203");
  });

  it("parses rgb() with space separators", () => {
    expect(parseRgbToHex("rgb(255 128 0)")).toBe("#ff8000");
  });

  it("ignores the alpha channel", () => {
    expect(parseRgbToHex("rgba(17, 34, 51, 0.5)")).toBe("#112233");
    expect(parseRgbToHex("rgb(17 34 51 / 50%)")).toBe("#112233");
  });

  it("rounds fractional channels", () => {
    expect(parseRgbToHex("rgb(0.6, 1.4, 254.5)")).toBe("#0101ff");
  });

  it("clamps out-of-range channels", () => {
    expect(parseRgbToHex("rgb(-20, 300, 0)")).toBe("#00ff00");
  });

  it("returns null for anything it cannot read", () => {
    expect(parseRgbToHex("")).toBe(null);
    expect(parseRgbToHex("transparent")).toBe(null);
    expect(parseRgbToHex("oklch(0.5 0.1 200)")).toBe(null);
    expect(parseRgbToHex("rgb(a, b, c)")).toBe(null);
    expect(parseRgbToHex("rgb(1, 2)")).toBe(null);
  });
});
