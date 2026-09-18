import { describe, expect, it } from "vitest";

import { isEmptyPatch, mergePatches } from "./merge.ts";

describe("mergePatches", () => {
  it("keeps the later value for the same field", () => {
    expect(mergePatches({ logs: { gutter: 70 } }, { logs: { gutter: 90 } })).toEqual({
      logs: { gutter: 90 },
    });
  });

  it("keeps a sibling field the later patch did not mention", () => {
    expect(mergePatches({ logs: { gutter: 70 } }, { logs: { taskGutter: 200 } })).toEqual({
      logs: { gutter: 70, taskGutter: 200 },
    });
  });

  it("does not drop an unrelated section that was queued first", () => {
    expect(mergePatches({ appearance: { theme: "light" } }, { logs: { gutter: 90 } })).toEqual({
      appearance: { theme: "light" },
      logs: { gutter: 90 },
    });
  });
});

describe("isEmptyPatch", () => {
  it("recognises nothing to send", () => {
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ logs: {} })).toBe(true);
  });

  it("recognises something to send", () => {
    expect(isEmptyPatch({ logs: { gutter: 90 } })).toBe(false);
  });
});
