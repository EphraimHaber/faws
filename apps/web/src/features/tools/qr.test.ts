import { describe, expect, it } from "vitest";

import { byteCapacity, encodeQr, partHeader, planQr, splitText, utf8Length } from "./qr";

describe("byteCapacity", () => {
  it("matches the published byte mode capacities", () => {
    expect(byteCapacity(1, "L")).toBe(17);
    expect(byteCapacity(1, "H")).toBe(7);
    expect(byteCapacity(10, "M")).toBe(213);
    expect(byteCapacity(40, "L")).toBe(2953);
    expect(byteCapacity(40, "H")).toBe(1273);
  });
});

describe("splitText", () => {
  it("keeps every part within the limit, header included", () => {
    const text = "x".repeat(1000);
    const parts = splitText(text, 100, true);
    expect(parts.every((part) => utf8Length(part) <= 100)).toBe(true);
    expect(parts[0]?.startsWith(partHeader(0, parts.length))).toBe(true);
  });

  it("never cuts a multi byte character", () => {
    const text = "é😀".repeat(200);
    const parts = splitText(text, 50, false);
    expect(parts.join("")).toBe(text);
    expect(parts.every((part) => utf8Length(part) <= 50)).toBe(true);
  });

  it("reassembles to the original once headers are stripped", () => {
    const text = Array.from({ length: 3000 }, (_, i) => String(i % 10)).join("");
    const parts = splitText(text, 40, true);
    const bodies = parts.map((part, i) => part.slice(partHeader(i, parts.length).length));
    expect(bodies.join("")).toBe(text);
  });
});

describe("planQr", () => {
  it("leaves text that fits in one symbol untouched", () => {
    const plan = planQr("hello", { version: 10, level: "M", header: true });
    expect(plan.parts).toEqual(["hello"]);
  });

  it("returns no parts for empty text", () => {
    expect(planQr("", { version: 10, level: "M", header: true }).parts).toEqual([]);
  });
});

describe("encodeQr", () => {
  it("picks the smallest version that holds the part", () => {
    expect(encodeQr("hi", 40, "M").version).toBe(1);
    expect(encodeQr("x".repeat(200), 40, "M").version).toBe(10);
  });
});
