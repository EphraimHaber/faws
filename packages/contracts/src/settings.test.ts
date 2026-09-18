import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOG_GUTTER,
  DEFAULT_SETTINGS,
  MAX_SILENCE_ENTRIES,
  pruneSilenced,
  type SilenceEntry,
  settingsPatchSchema,
  settingsSchema,
} from "./settings.ts";

function entry(arn: string, at: string): SilenceEntry {
  return { arn, label: arn, context: "", at };
}

describe("settingsSchema", () => {
  it("fills every section from an empty object", () => {
    expect(DEFAULT_SETTINGS.scope.profile).toBe("default");
    expect(DEFAULT_SETTINGS.logs.gutter).toBe(DEFAULT_LOG_GUTTER);
    expect(DEFAULT_SETTINGS.appearance.theme).toBe("dark");
    expect(DEFAULT_SETTINGS.terminal.recordByDefault).toBe(true);
    expect(DEFAULT_SETTINGS.silenced).toEqual({ dismissed: {}, muted: {} });
  });

  it("costs one bad leaf only itself", () => {
    const parsed = settingsSchema.parse({ version: 1, logs: { gutter: "nope", taskGutter: 200 } });
    expect(parsed.logs.gutter).toBe(DEFAULT_LOG_GUTTER);
    expect(parsed.logs.taskGutter).toBe(200);
  });

  it("rejects a gutter narrower than the floor by falling back", () => {
    expect(settingsSchema.parse({ logs: { gutter: 4 } }).logs.gutter).toBe(DEFAULT_LOG_GUTTER);
  });

  it("replaces a section of the wrong type with a defaulted one", () => {
    expect(settingsSchema.parse({ version: 1, scope: "nonsense" }).scope).toEqual(
      DEFAULT_SETTINGS.scope,
    );
  });

  it("only accepts refresh intervals that are on the menu", () => {
    expect(settingsSchema.parse({ scope: { refreshSeconds: 60 } }).scope.refreshSeconds).toBe(60);
    expect(settingsSchema.parse({ scope: { refreshSeconds: 7 } }).scope.refreshSeconds).toBe(30);
    // A missing key coerces to nothing, not to 0 - an interval that isn't even
    // on the menu is exactly what the membership check exists to stop.
    expect(settingsSchema.parse({ scope: {} }).scope.refreshSeconds).toBe(30);
  });
});

describe("settingsPatchSchema", () => {
  it("accepts a partial section", () => {
    expect(settingsPatchSchema.parse({ logs: { gutter: 90 } })).toEqual({ logs: { gutter: 90 } });
  });

  it("refuses a silenced patch rather than dropping it silently", () => {
    expect(settingsPatchSchema.safeParse({ silenced: { muted: {} } }).success).toBe(false);
  });
});

describe("pruneSilenced", () => {
  it("leaves a map under the cap alone", () => {
    const muted = { a: entry("a", "2026-01-01T00:00:00.000Z") };
    expect(pruneSilenced({ dismissed: {}, muted }).muted).toBe(muted);
  });

  it("evicts the oldest entries once the cap is passed", () => {
    const muted: Record<string, SilenceEntry> = {};
    for (let i = 0; i < MAX_SILENCE_ENTRIES + 10; i++) {
      // Lexicographic order on an ISO stamp is chronological order.
      muted[`arn-${i}`] = entry(`arn-${i}`, `2026-01-01T00:00:${String(i).padStart(5, "0")}Z`);
    }
    const pruned = pruneSilenced({ dismissed: {}, muted }).muted;
    expect(Object.keys(pruned)).toHaveLength(MAX_SILENCE_ENTRIES);
    expect(pruned["arn-0"]).toBeUndefined();
    expect(pruned[`arn-${MAX_SILENCE_ENTRIES + 9}`]).toBeDefined();
  });
});
