import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOG_GUTTER,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  applyPatch,
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

  it("defaults the sidebar width, and clamps one that is out of range", () => {
    expect(DEFAULT_SETTINGS.layout.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    // A width outside the range is a value the rail cannot render usefully, so
    // it falls back rather than being honoured.
    expect(
      settingsSchema.parse({ layout: { sidebarWidth: MIN_SIDEBAR_WIDTH - 1 } }).layout,
    ).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH });
    expect(
      settingsSchema.parse({ layout: { sidebarWidth: MAX_SIDEBAR_WIDTH + 1 } }).layout,
    ).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH });
  });

  it("carries a layout patch through applyPatch", () => {
    // The easy miss: `settingsPatchSchema` is strict, so a section added there
    // but not to `applyPatch` validates and is then silently dropped.
    const patch = settingsPatchSchema.parse({ layout: { sidebarWidth: 300 } });
    expect(applyPatch(DEFAULT_SETTINGS, patch).layout.sidebarWidth).toBe(300);
  });

  it("carries a kube patch through applyPatch", () => {
    // The easy miss, and the reason this test exists: `settingsPatchSchema` is
    // strict, so a section added there and forgotten in `applyPatch` validates
    // cleanly and is then dropped by the merge - which looks from the outside
    // exactly like a preference that will not stick.
    const patch = settingsPatchSchema.parse({ kube: { context: "prod", namespace: "payments" } });
    expect(applyPatch(DEFAULT_SETTINGS, patch).kube).toEqual({
      context: "prod",
      namespace: "payments",
    });
  });

  it("starts with no kube scope, meaning the kubeconfig's own", () => {
    expect(DEFAULT_SETTINGS.kube).toEqual({ context: "", namespace: "" });
    expect(settingsSchema.parse({ kube: { context: 7 } }).kube.context).toBe("");
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

describe("silencedSettingsSchema", () => {
  it("costs one unreadable entry only itself", () => {
    const parsed = settingsSchema.parse({
      silenced: {
        muted: { good: entry("good", "2026-01-01T00:00:00.000Z"), broken: { arn: "" } },
        dismissed: {},
      },
    });
    expect(Object.keys(parsed.silenced.muted)).toEqual(["good"]);
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

describe("s3 endpoints", () => {
  const endpoint = {
    id: "abc",
    name: "MinIO",
    endpoint: "https://s3.corp.internal:9000",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { mode: "stored", ref: "cred-1" },
    tls: {
      verify: true,
      caPaths: [],
      caPem: null,
      clientCertPath: null,
      clientKeyPath: null,
      servername: null,
      pinnedSha256: null,
    },
    features: { storageMetrics: false, presign: true },
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("keeps the endpoints it can read and drops only the ones it cannot", () => {
    const parsed = settingsSchema.parse({
      s3: { connections: [endpoint, { id: "broken" }, { ...endpoint, id: "def", name: "Ceph" }] },
    });

    expect(parsed.s3.connections.map((entry) => entry.id)).toEqual(["abc", "def"]);
  });

  it("turns an endpoint with an unreadable section back into a safe default", () => {
    const parsed = settingsSchema.parse({
      s3: { connections: [{ ...endpoint, tls: "nonsense" }] },
    });

    expect(parsed.s3.connections[0]?.tls.verify).toBe(true);
  });

  it("has no endpoints in a file written before they existed", () => {
    expect(settingsSchema.parse({ scope: { profile: "prod" } }).s3.connections).toEqual([]);
  });
});
