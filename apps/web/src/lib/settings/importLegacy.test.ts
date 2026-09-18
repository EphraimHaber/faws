/**
 * `window` is stubbed the same way `lib/stored.test.ts` does it: there is no
 * testing-library in this app, and none of this needs a DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BACKUP_KEY, clearLegacyKeys, collectLegacySettings } from "./importLegacy.ts";

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectLegacySettings", () => {
  it("returns null for a browser that never had any", () => {
    expect(collectLegacySettings()).toBeNull();
  });

  it("only sends the keys that are actually there", () => {
    store.set("faws:theme", "light");
    const legacy = collectLegacySettings();

    expect(legacy?.patch).toEqual({ appearance: { theme: "light" } });
    expect(legacy?.keys).toEqual(["faws:theme"]);
  });

  it("translates every key into its section", () => {
    store.set("faws:profile", "prod");
    store.set("faws:region", "eu-west-1");
    store.set("faws:refresh", "60");
    store.set("faws:logTimestamps", "full");
    store.set("faws:logGutter", "90");
    store.set("faws:logTaskGutter", "200");
    store.set("faws:theme", "light");
    store.set("faws:terminal:height", "400");
    store.set("faws:terminal:record", "0");

    expect(collectLegacySettings()?.patch).toEqual({
      scope: { profile: "prod", region: "eu-west-1", refreshSeconds: 60 },
      logs: { timestamps: "full", gutter: 90, taskGutter: 200 },
      appearance: { theme: "light" },
      terminal: { dockHeight: 400, recordByDefault: false },
    });
  });

  it("unwraps the zustand persist envelope around the silence maps", () => {
    store.set(
      "faws:silenced",
      JSON.stringify({
        version: 0,
        state: {
          dismissed: {},
          muted: { a: { arn: "a", label: "A", context: "prod", at: "2026-01-01T00:00:00.000Z" } },
        },
      }),
    );

    const legacy = collectLegacySettings();
    expect(legacy?.silenced.muted?.["a"]?.label).toBe("A");
    // An empty map is left out rather than sent as an empty overwrite.
    expect(legacy?.silenced.dismissed).toBeUndefined();
  });

  it("survives a silence blob it cannot read", () => {
    store.set("faws:silenced", "{ not json");
    expect(collectLegacySettings()?.silenced).toEqual({});
  });

  it("falls back on a garbage value rather than dropping the key", () => {
    store.set("faws:theme", "chartreuse");
    expect(collectLegacySettings()?.patch).toEqual({ appearance: { theme: "dark" } });
  });
});

describe("clearLegacyKeys", () => {
  it("archives the old values and removes them", () => {
    store.set("faws:theme", "light");
    store.set("faws:profile", "prod");
    clearLegacyKeys(["faws:theme", "faws:profile"]);

    expect(store.has("faws:theme")).toBe(false);
    expect(store.has("faws:profile")).toBe(false);
    expect(JSON.parse(store.get(BACKUP_KEY) as string)).toEqual({
      "faws:theme": "light",
      "faws:profile": "prod",
    });
  });
});
