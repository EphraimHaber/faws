import { EXEC_KINDS } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { openTabSchema, storedOpenTabs } from "./open-tabs.ts";

/**
 * The regression this file exists for: the list is parsed as one array, so a
 * kind the schema has not been told about does not cost that one tab. It costs
 * the whole dock - every remembered session gone, silently, with the window
 * coming back empty and nothing said about why.
 */

function tab(kind: string) {
  return { id: "1", target: { kind }, title: "t", subtitle: "s", kind };
}

describe("openTabSchema", () => {
  it("accepts every kind the handshake accepts", () => {
    for (const kind of EXEC_KINDS) {
      expect(openTabSchema.safeParse([tab(kind)]).success).toBe(true);
    }
  });

  it("rejects the whole list over one unknown kind, which is why the enum is shared", () => {
    expect(openTabSchema.safeParse([tab("ssh"), tab("some-future-kind")]).success).toBe(false);
  });

  it("carries the target through untouched, since only the store reads it", () => {
    const target = {
      kind: "kube",
      context: "prod",
      namespace: "default",
      target: { tool: "kubectl", pod: "api-0", command: ["/bin/sh"] },
    };
    const parsed = openTabSchema.parse([
      { id: "1", target, title: "api-0", subtitle: "prod / default", kind: "kube" },
    ]);
    expect(parsed[0]?.target).toEqual(target);
  });
});

describe("storedOpenTabs", () => {
  it("reads back a remembered kube tab", () => {
    expect(storedOpenTabs.parse(JSON.stringify([tab("kube")]))).toHaveLength(1);
  });

  it("answers nothing remembered when storage held nothing", () => {
    expect(storedOpenTabs.parse(null)).toEqual([]);
  });
});
