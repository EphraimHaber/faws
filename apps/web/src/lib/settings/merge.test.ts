import { settingsPatchSchema } from "@faws/contracts";
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

  it("carries the kube scope and the sidebar width", () => {
    expect(mergePatches({ kube: { context: "prod" } }, { layout: { sidebarWidth: 300 } })).toEqual({
      kube: { context: "prod" },
      layout: { sidebarWidth: 300 },
    });
  });

  it("carries every section the patch schema accepts", () => {
    // A section the server accepts but this merge does not know is kept on
    // screen and in the cache and never sent, so it looks saved until reload.
    for (const key of Object.keys(settingsPatchSchema.shape)) {
      const patch = { [key]: { probe: 1 } } as never;
      expect(mergePatches({}, patch), key).toEqual(patch);
      expect(isEmptyPatch(patch), key).toBe(false);
    }
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
