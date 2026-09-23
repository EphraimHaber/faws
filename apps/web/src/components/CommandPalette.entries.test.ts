import { RESOURCE_KINDS } from "@faws/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  entryText,
  groupBoost,
  kindIcon,
  navEntries,
  shellEntries,
  type PaletteEntry,
} from "./CommandPalette.entries.ts";
import { rankBy } from "~/lib/rank";
import { AWS_SERVICES } from "~/services/registry";

const icons = { diagnostics: AWS_SERVICES[0].icon, settings: AWS_SERVICES[0].icon };

const EVERYTHING = { kubeVirt: true };

function allEntries(navigate = () => {}): PaletteEntry[] {
  return [...navEntries(navigate, EVERYTHING), ...shellEntries(navigate, icons)];
}

describe("navEntries", () => {
  it("offers every available service and its sections", () => {
    const ids = new Set(allEntries().map((entry) => entry.id));
    for (const service of AWS_SERVICES) {
      if (service.status !== "available") continue;
      expect(ids.has(`nav:${service.id}`)).toBe(true);
      for (const section of service.sections) {
        expect(ids.has(`nav:${service.id}:${section.id}`)).toBe(true);
      }
    }
  });

  it("puts EC2's instance list first for its own name", () => {
    const ranked = rankBy(allEntries(), "instances", entryText, groupBoost);
    expect(ranked[0]?.id).toBe("nav:ec2:instances");
  });

  it("leaves out services that are only planned", () => {
    const ids = allEntries().map((entry) => entry.id);
    for (const service of AWS_SERVICES) {
      if (service.status === "available") continue;
      expect(ids).not.toContain(`nav:${service.id}`);
    }
  });

  it("navigates to the section's own route", () => {
    const navigate = vi.fn();
    const buckets = navEntries(navigate, EVERYTHING).find((entry) => entry.id === "nav:s3:buckets");
    buckets?.run();
    expect(navigate).toHaveBeenCalledWith("/s3/buckets");
  });

  it("offers the Sessions page, which lists every open terminal", () => {
    const sessions = navEntries(() => {}, EVERYTHING).find((entry) => entry.id === "nav:sessions");
    expect(sessions?.label).toBe("Sessions");
  });

  it("offers session recordings as a section of Sessions", () => {
    const navigate = vi.fn();
    const recordings = navEntries(navigate, EVERYTHING).find(
      (entry) => entry.id === "nav:sessions:recordings",
    );
    recordings?.run();
    expect(navigate).toHaveBeenCalledWith("/sessions/recordings");
  });

  it("offers Virtual machines only on a cluster that has KubeVirt, as the sidebar does", () => {
    const id = "nav:kubernetes:virtual-machines";
    const without = navEntries(() => {}, { kubeVirt: false }).map((entry) => entry.id);
    expect(without).not.toContain(id);
    expect(without).toContain("nav:kubernetes:workloads");
    expect(navEntries(() => {}, { kubeVirt: true }).map((entry) => entry.id)).toContain(id);
  });
});

describe("finding an entry by what it is called elsewhere", () => {
  it("reaches Diagnostics by typing logs", () => {
    const ranked = rankBy(allEntries(), "logs", entryText, groupBoost);
    expect(ranked[0]?.id).toBe("nav:logs");
  });

  it("reaches Settings by typing theme", () => {
    const ranked = rankBy(allEntries(), "theme", entryText, groupBoost);
    expect(ranked[0]?.id).toBe("nav:settings");
  });
});

describe("group ordering", () => {
  const entry = (group: PaletteEntry["group"], label: string): PaletteEntry => ({
    id: label,
    icon: icons.settings,
    label,
    hint: "",
    keywords: [],
    group,
    run: () => {},
  });

  it("puts actions above pages above account contents with no query", () => {
    const ranked = rankBy(
      [entry("resource", "a"), entry("nav", "b"), entry("action", "c")],
      "",
      entryText,
      groupBoost,
    );
    expect(ranked.map((e) => e.group)).toEqual(["action", "nav", "resource"]);
  });

  it("still lets an exactly-named resource beat a weakly-matched page", () => {
    // The point of boosting rather than sorting by group: typing a cluster's
    // name must not bury it under every page whose letters happen to fit.
    const ranked = rankBy(
      [entry("nav", "Recently deployed"), entry("resource", "prod")],
      "prod",
      entryText,
      groupBoost,
    );
    expect(ranked[0]?.label).toBe("prod");
  });
});

describe("kindIcon", () => {
  it("has an icon for every kind a pin can be", () => {
    for (const kind of RESOURCE_KINDS) expect(kindIcon(kind)).toBeDefined();
  });
});
