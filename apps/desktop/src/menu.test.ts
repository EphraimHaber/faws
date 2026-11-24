import { describe, expect, it } from "vitest";

import { DEFAULT_NAV, navMenuItems, sanitizeNavItems } from "./menu.ts";

describe("sanitizeNavItems", () => {
  it("keeps well-formed in-app destinations", () => {
    expect(
      sanitizeNavItems([{ label: "Clusters", target: "/ecs/clusters", group: "aws" }]),
    ).toEqual([{ label: "Clusters", target: "/ecs/clusters", group: "aws" }]);
  });

  it("drops anything that is not an in-app path", () => {
    expect(
      sanitizeNavItems([
        { label: "Evil", target: "https://example.com", group: "x" },
        { label: "Protocol relative", target: "//example.com", group: "x" },
        { label: "", target: "/empty-label", group: "x" },
        "nonsense",
      ]),
    ).toEqual([]);
  });

  it("falls back to the defaults for something that is not a list", () => {
    expect(sanitizeNavItems({ nope: true })).toEqual(DEFAULT_NAV);
  });
});

describe("navMenuItems", () => {
  it("numbers provider destinations, never the app's own, and gives Settings Cmd+,", () => {
    const items = navMenuItems(
      [
        { label: "Clusters", target: "/ecs/clusters", group: "aws" },
        { label: "Workloads", target: "/kubernetes/workloads", group: "kubernetes" },
        ...DEFAULT_NAV,
      ],
      () => {},
    );
    const accelerators = Object.fromEntries(
      items.filter((item) => item.label).map((item) => [item.label, item.accelerator]),
    );
    expect(accelerators).toEqual({
      Overview: "CmdOrCtrl+0",
      Clusters: "CmdOrCtrl+1",
      Workloads: "CmdOrCtrl+2",
      Diagnostics: undefined,
      Settings: "CmdOrCtrl+,",
    });
  });
});
