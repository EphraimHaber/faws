import { describe, expect, it } from "vitest";

import {
  applyRecentOp,
  inScope,
  MAX_PINNED_ENTRIES,
  MAX_RECENT_ENTRIES,
  pruneRecents,
  type RecentEntry,
  type RecentsSettings,
  recentsSettingsSchema,
  resourceKey,
  type ResourceRef,
} from "./recents.ts";
import { settingsSchema } from "./settings.ts";

const AT = new Date("2026-01-01T12:00:00.000Z");

function ref(overrides: Partial<ResourceRef> = {}): ResourceRef {
  return {
    kind: "s3-bucket",
    id: "arn:aws:s3:::logs",
    label: "logs",
    detail: "",
    scope: { profile: "default", region: "us-east-1", connectionId: "" },
    to: "/s3/buckets/logs",
    ...overrides,
  };
}

function entry(key: string, at: string): RecentEntry {
  return { ...ref({ id: key }), at };
}

const EMPTY: RecentsSettings = { visited: {}, pinned: {} };

describe("resourceKey", () => {
  it("separates the same natural key in two accounts", () => {
    const a = resourceKey(
      ref({ id: "data", scope: { profile: "dev", region: "eu-west-1", connectionId: "" } }),
    );
    const b = resourceKey(
      ref({ id: "data", scope: { profile: "prod", region: "eu-west-1", connectionId: "" } }),
    );
    expect(a).not.toBe(b);
  });

  it("separates the same id under two kinds", () => {
    expect(resourceKey(ref({ kind: "s3-bucket" }))).not.toBe(
      resourceKey(ref({ kind: "s3-prefix" })),
    );
  });

  it("ignores the parts that are only there to be drawn", () => {
    // The label and the route go stale; re-recording a bucket under a new name
    // has to land on the row that is already there rather than beside it.
    expect(resourceKey(ref({ label: "logs", to: "/s3/buckets/logs" }))).toBe(
      resourceKey(ref({ label: "Logs (renamed)", to: "/s3/buckets/logs?prefix=a/" })),
    );
  });
});

describe("applyRecentOp", () => {
  it("records a visit under its key, with the clock it was handed", () => {
    const next = applyRecentOp(EMPTY, { op: "record", ref: ref() }, AT);
    expect(next.visited[resourceKey(ref())]?.at).toBe(AT.toISOString());
    expect(next.pinned).toEqual({});
  });

  it("re-recording replaces the entry rather than adding one", () => {
    const once = applyRecentOp(EMPTY, { op: "record", ref: ref() }, AT);
    const later = new Date("2026-01-02T12:00:00.000Z");
    const twice = applyRecentOp(once, { op: "record", ref: ref({ label: "renamed" }) }, later);
    expect(Object.keys(twice.visited)).toHaveLength(1);
    expect(Object.values(twice.visited)[0]).toMatchObject({
      label: "renamed",
      at: later.toISOString(),
    });
  });

  it("leaves a pin's own timestamp alone when the resource is visited again", () => {
    // A pin is the moment you decided to keep something. Re-stamping it on
    // every visit would sort the pinned list by recency, which is the one
    // thing pinning exists not to be.
    const pinned = applyRecentOp(EMPTY, { op: "pin", ref: ref() }, AT);
    const visited = applyRecentOp(
      pinned,
      { op: "record", ref: ref() },
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(visited.pinned[resourceKey(ref())]?.at).toBe(AT.toISOString());
  });

  it("unpins without forgetting the visit", () => {
    const key = resourceKey(ref());
    let state = applyRecentOp(EMPTY, { op: "record", ref: ref() }, AT);
    state = applyRecentOp(state, { op: "pin", ref: ref() }, AT);
    state = applyRecentOp(state, { op: "unpin", key }, AT);
    expect(state.pinned).toEqual({});
    expect(state.visited[key]).toBeDefined();
  });

  it("forgets from both maps at once", () => {
    // What the button says: stop remembering this. Which of the two mechanisms
    // was holding onto it is not something the person asked about.
    const key = resourceKey(ref());
    let state = applyRecentOp(EMPTY, { op: "record", ref: ref() }, AT);
    state = applyRecentOp(state, { op: "pin", ref: ref() }, AT);
    state = applyRecentOp(state, { op: "forget", key }, AT);
    expect(state).toEqual(EMPTY);
  });

  it("forgetting a key that is not there changes nothing", () => {
    const state = applyRecentOp(EMPTY, { op: "record", ref: ref() }, AT);
    expect(applyRecentOp(state, { op: "forget", key: "nope" }, AT)).toEqual(state);
  });

  it("clears only the map forgetAll was aimed at", () => {
    let state = applyRecentOp(EMPTY, { op: "record", ref: ref() }, AT);
    state = applyRecentOp(state, { op: "pin", ref: ref({ id: "other" }) }, AT);

    expect(applyRecentOp(state, { op: "forgetAll", target: "visited" }, AT)).toEqual({
      visited: {},
      pinned: state.pinned,
    });
    expect(applyRecentOp(state, { op: "forgetAll", target: "pinned" }, AT)).toEqual({
      visited: state.visited,
      pinned: {},
    });
    expect(applyRecentOp(state, { op: "forgetAll", target: "both" }, AT)).toEqual(EMPTY);
  });
});

describe("pruneRecents", () => {
  it("leaves a map under the cap untouched", () => {
    const state = applyRecentOp(EMPTY, { op: "record", ref: ref() }, AT);
    expect(pruneRecents(state)).toEqual(state);
  });

  it("drops the oldest visits past the cap", () => {
    const visited: Record<string, RecentEntry> = {};
    for (let i = 0; i < MAX_RECENT_ENTRIES + 10; i += 1) {
      // Zero-padded so the string compare the prune sorts by is the numeric one.
      visited[`k${i}`] = entry(`k${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`);
    }
    const pruned = pruneRecents({ visited, pinned: {} }).visited;
    expect(Object.keys(pruned)).toHaveLength(MAX_RECENT_ENTRIES);
    expect(pruned["k0"]).toBeUndefined();
    expect(pruned[`k${MAX_RECENT_ENTRIES + 9}`]).toBeDefined();
  });

  it("caps the pin list separately, and lower", () => {
    const pinned: Record<string, RecentEntry> = {};
    for (let i = 0; i < MAX_PINNED_ENTRIES + 5; i += 1) {
      pinned[`k${i}`] = entry(`k${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`);
    }
    expect(Object.keys(pruneRecents({ visited: {}, pinned }).pinned)).toHaveLength(
      MAX_PINNED_ENTRIES,
    );
  });
});

describe("recentsSettingsSchema", () => {
  it("costs one unreadable map only itself", () => {
    const parsed = recentsSettingsSchema.parse({
      visited: { good: { ...ref(), at: AT.toISOString() } },
      pinned: "nonsense",
    });
    expect(parsed.visited["good"]).toBeDefined();
    expect(parsed.pinned).toEqual({});
  });

  it("costs one unreadable entry only itself", () => {
    // A kind from a newer build is the realistic case: it must not take the
    // entries this build can read down with it.
    const parsed = recentsSettingsSchema.parse({
      visited: {
        good: { ...ref(), at: AT.toISOString() },
        future: { ...ref(), kind: "future-kind", at: AT.toISOString() },
      },
      pinned: { good: { ...ref(), at: AT.toISOString() }, broken: { label: "" } },
    });
    expect(Object.keys(parsed.visited)).toEqual(["good"]);
    expect(Object.keys(parsed.pinned)).toEqual(["good"]);
  });

  it("fills a missing scope rather than dropping the entry", () => {
    const parsed = recentsSettingsSchema.parse({
      visited: { good: { ...ref(), scope: undefined, at: AT.toISOString() } },
    });
    expect(parsed.visited["good"]?.scope).toEqual({ profile: "", region: "", connectionId: "" });
  });

  it("arrives in the settings file as an empty, defaulted section", () => {
    // Additive: a file written before this reads back with the section rather
    // than failing, which is what keeps `SETTINGS_VERSION` where it is.
    expect(settingsSchema.parse({ version: 1 }).recents).toEqual(EMPTY);
  });
});

describe("inScope", () => {
  const here = { profile: "default", region: "us-east-1", connectionId: "" };

  it("hides another account's entry without deleting it", () => {
    expect(inScope(ref({ scope: { ...here, profile: "other" } }), here)).toBe(false);
    expect(inScope(ref({ scope: { ...here, region: "eu-west-1" } }), here)).toBe(false);
    expect(inScope(ref(), here)).toBe(true);
  });

  it("always shows an entry with no profile", () => {
    // An SSH host is reached from this machine, not through an account - and an
    // entry whose scope was unreadable defaults to this too, which is the right
    // way round: a row that is always visible can be forgotten.
    expect(
      inScope(
        ref({ kind: "ssh-host", scope: { profile: "", region: "", connectionId: "" } }),
        here,
      ),
    ).toBe(true);
  });

  it("compares the endpoint for S3 kinds only", () => {
    // `connectionId` says where S3 calls go and means nothing to an ECS
    // cluster; comparing it everywhere would blank the ECS rows the moment a
    // non-AWS endpoint was picked.
    const onMinio = { ...here, connectionId: "minio" };
    expect(inScope(ref({ kind: "s3-bucket", scope: onMinio }), here)).toBe(false);
    expect(inScope(ref({ kind: "ecs-cluster", scope: onMinio }), here)).toBe(true);
  });
});
