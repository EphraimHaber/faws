import { describe, expect, it, vi } from "vitest";

import {
  entryText,
  groupBoost,
  navEntries,
  shellEntries,
  type PaletteEntry,
} from "./CommandPalette.entries.ts";
import { rankBy } from "~/lib/rank";
import { AWS_SERVICES } from "~/services/registry";

const icons = { diagnostics: AWS_SERVICES[0].icon, settings: AWS_SERVICES[0].icon };

function allEntries(navigate = () => {}): PaletteEntry[] {
  return [...navEntries(navigate), ...shellEntries(navigate, icons)];
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

  it("includes EC2, which the hardcoded list had omitted entirely", () => {
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
    const buckets = navEntries(navigate).find((entry) => entry.id === "nav:s3:buckets");
    buckets?.run();
    expect(navigate).toHaveBeenCalledWith("/s3/buckets");
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
