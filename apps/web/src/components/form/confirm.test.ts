import { describe, expect, it } from "vitest";

import { confirmMatches, confirmProgress } from "./confirm.ts";

describe("confirmMatches", () => {
  it("accepts the exact string", () => {
    expect(confirmMatches("my-bucket", "my-bucket")).toBe(true);
  });

  it("forgives surrounding whitespace, which is what a paste carries", () => {
    expect(confirmMatches("my-bucket", "  my-bucket\n")).toBe(true);
  });

  it("rejects a different case", () => {
    expect(confirmMatches("my-bucket", "My-Bucket")).toBe(false);
  });

  it("rejects a near miss", () => {
    expect(confirmMatches("my-bucket", "my-bucke")).toBe(false);
    expect(confirmMatches("my-bucket", "my-buckets")).toBe(false);
  });

  it("rejects an empty or missing entry", () => {
    expect(confirmMatches("my-bucket", "")).toBe(false);
    expect(confirmMatches("my-bucket", undefined)).toBe(false);
  });

  it("never matches when nothing was expected", () => {
    expect(confirmMatches("", "")).toBe(false);
    expect(confirmMatches("", "anything")).toBe(false);
  });
});

describe("confirmProgress", () => {
  it("counts the shared prefix", () => {
    expect(confirmProgress("abcd", "ab")).toBe(0.5);
    expect(confirmProgress("abcd", "abcd")).toBe(1);
  });

  it("stops at the first divergence", () => {
    expect(confirmProgress("abcd", "axcd")).toBe(0.25);
  });

  it("is zero for nothing typed", () => {
    expect(confirmProgress("abcd", undefined)).toBe(0);
  });
});
