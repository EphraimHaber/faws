import { describe, expect, it } from "vitest";

import { looksLikePattern, toFilterPattern } from "./log-filter.ts";

describe("toFilterPattern", () => {
  it("quotes plain search text so punctuation is matched literally", () => {
    // The bug this exists to prevent: bare `10-0` is valid pattern syntax that
    // matches nothing, rather than a search for the characters "10-0".
    expect(toFilterPattern("10-0", "search")).toBe('"10-0"');
    expect(toFilterPattern("ip-10-0-9-128", "search")).toBe('"ip-10-0-9-128"');
    expect(toFilterPattern("GET /game/command", "search")).toBe('"GET /game/command"');
  });

  it("escapes quotes and backslashes rather than closing the literal early", () => {
    expect(toFilterPattern('say "hi"', "search")).toBe(String.raw`"say \"hi\""`);
    expect(toFilterPattern(String.raw`C:\logs`, "search")).toBe(String.raw`"C:\\logs"`);
  });

  it("sends pattern mode through untouched", () => {
    expect(toFilterPattern('{$.level = "error"}', "pattern")).toBe('{$.level = "error"}');
    expect(toFilterPattern("?ERROR ?WARN", "pattern")).toBe("?ERROR ?WARN");
    expect(toFilterPattern("10-0", "pattern")).toBe("10-0");
  });

  it("treats blank input as no filter in either mode", () => {
    expect(toFilterPattern("", "search")).toBeNull();
    expect(toFilterPattern("   ", "pattern")).toBeNull();
  });
});

describe("looksLikePattern", () => {
  it("recognises the characters that can only begin a pattern", () => {
    expect(looksLikePattern('{$.level = "error"}')).toBe(true);
    expect(looksLikePattern("?ERROR")).toBe(true);
    expect(looksLikePattern("-healthcheck")).toBe(true);
    expect(looksLikePattern('"quoted"')).toBe(true);
  });

  it("leaves ordinary searches alone", () => {
    expect(looksLikePattern("10-0")).toBe(false);
    expect(looksLikePattern("timeout")).toBe(false);
    expect(looksLikePattern("")).toBe(false);
  });
});
