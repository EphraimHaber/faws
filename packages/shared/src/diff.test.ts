import { describe, expect, it } from "vitest";

import { diffLines, diffStat, DiffTooLargeError, MAX_DIFF_LINES } from "./diff.ts";

const shape = (before: string, after: string) =>
  diffLines(before, after).map((line) => `${line.kind[0]}:${line.text}`);

describe("diffLines", () => {
  it("reports identical texts as unchanged", () => {
    expect(shape("a\nb\n", "a\nb\n")).toEqual(["s:a", "s:b"]);
  });

  it("marks an inserted line without disturbing the rest", () => {
    expect(shape("a\nc\n", "a\nb\nc\n")).toEqual(["s:a", "a:b", "s:c"]);
  });

  it("marks a removed line", () => {
    expect(shape("a\nb\nc\n", "a\nc\n")).toEqual(["s:a", "r:b", "s:c"]);
  });

  it("reads a changed line as a removal and an addition", () => {
    expect(shape("a\nb\n", "a\nB\n")).toEqual(["s:a", "r:b", "a:B"]);
  });

  it("keeps a moved block from reading as every line changing", () => {
    const lines = diffLines("x\na\nb\nc\n", "a\nb\nc\ny\n");
    expect(diffStat(lines)).toEqual({ added: 1, removed: 1 });
  });

  it("numbers each side independently", () => {
    const lines = diffLines("a\nc\n", "a\nb\nc\n");
    expect(lines.map((line) => [line.left, line.right])).toEqual([
      [1, 1],
      [null, 2],
      [2, 3],
    ]);
  });

  it("treats a trailing newline as ending the last line", () => {
    expect(shape("a\n", "a")).toEqual(["s:a"]);
  });

  it("handles one side being empty", () => {
    expect(shape("", "a\n")).toEqual(["a:a"]);
    expect(shape("a\n", "")).toEqual(["r:a"]);
  });

  it("refuses a comparison too large to be worth attempting", () => {
    const huge = `${"x\n".repeat(MAX_DIFF_LINES)}`;
    expect(() => diffLines(huge, huge)).toThrow(DiffTooLargeError);
  });
});

describe("diffStat", () => {
  it("counts each side of the change", () => {
    expect(diffStat(diffLines("a\nb\n", "a\nB\nc\n"))).toEqual({ added: 2, removed: 1 });
  });
});
