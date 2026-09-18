import { describe, expect, it } from "vitest";

import { compileMatcher, globToRegex, isPattern, requiresDeep } from "./glob.ts";

describe("isPattern", () => {
  it("is true only for a query carrying a wildcard", () => {
    expect(isPattern("report")).toBe(false);
    expect(isPattern("*.json")).toBe(true);
    expect(isPattern("log?")).toBe(true);
    expect(isPattern("[abc]")).toBe(true);
  });
});

describe("requiresDeep", () => {
  it("escalates a query that spans separators", () => {
    expect(requiresDeep("logs/app")).toBe(true);
    expect(requiresDeep("**.json")).toBe(true);
  });

  it("leaves a query about one folder alone", () => {
    expect(requiresDeep("*.json")).toBe(false);
    expect(requiresDeep("report")).toBe(false);
  });
});

describe("compileMatcher", () => {
  it("matches a plain query as a case insensitive substring", () => {
    const match = compileMatcher("Report");
    expect(match("quarterly-report.pdf")).toBe(true);
    expect(match("summary.pdf")).toBe(false);
  });

  it("anchors a pattern, so a wildcard query is not also a substring one", () => {
    const match = compileMatcher("*.json");
    expect(match("app.json")).toBe(true);
    expect(match("app.json.bak")).toBe(false);
  });

  it("matches everything when nothing was typed", () => {
    const match = compileMatcher("   ");
    expect(match("anything")).toBe(true);
  });
});

describe("globToRegex", () => {
  it("stops a single star at a separator", () => {
    const regex = globToRegex("*.json");
    expect(regex.test("app.json")).toBe(true);
    expect(regex.test("logs/app.json")).toBe(false);
  });

  it("crosses separators with a double star", () => {
    const regex = globToRegex("**/*.json");
    expect(regex.test("logs/2026/app.json")).toBe(true);
    expect(regex.test("logs/app.json")).toBe(true);
  });

  it("collapses a run of stars", () => {
    expect(globToRegex("***.json").test("a/b/c.json")).toBe(true);
  });

  it("matches exactly one character with a question mark", () => {
    const regex = globToRegex("log?.txt");
    expect(regex.test("log1.txt")).toBe(true);
    expect(regex.test("log12.txt")).toBe(false);
    expect(regex.test("log/.txt")).toBe(false);
  });

  it("supports a character class and its negation", () => {
    expect(globToRegex("log[0-9].txt").test("log7.txt")).toBe(true);
    expect(globToRegex("log[0-9].txt").test("logx.txt")).toBe(false);
    expect(globToRegex("log[!0-9].txt").test("logx.txt")).toBe(true);
    expect(globToRegex("log[^0-9].txt").test("log7.txt")).toBe(false);
  });

  it("treats an unclosed bracket as a literal, so a half typed query still runs", () => {
    expect(globToRegex("log[.txt").test("log[.txt")).toBe(true);
  });

  it("does not let a dot in the pattern match any character", () => {
    expect(globToRegex("a.json").test("axjson")).toBe(false);
  });

  it("ignores case, as the rest of the filtering does", () => {
    expect(globToRegex("*.JSON").test("app.json")).toBe(true);
  });
});
