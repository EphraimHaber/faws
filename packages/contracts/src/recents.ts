/**
 * The resources this account has been looking at, and the ones it keeps.
 *
 * Every session used to start from a cold list: the bucket you were walking an
 * hour ago and the service you deploy every day were both exactly as far away
 * as a bucket you have never opened. These two maps are the memory of that,
 * and they live in the settings file rather than in `localStorage` for the same
 * reason the mute list does - the answer to "what am I working on" should
 * follow the person from the browser to the desktop app, not be a property of
 * one browser profile.
 *
 * A **ref** is everything needed to list a resource and navigate back to it,
 * denormalised on purpose. Resolving a stored ARN back into a name on every
 * paint would mean an AWS call per row, in whatever account happens to be in
 * scope, for a sidebar section - so the label and the route are stored beside
 * the id and can go stale. A stale row is a row that navigates somewhere that
 * no longer exists and can be forgotten; a row that costs a round trip to draw
 * is a rail that flickers.
 *
 * This file follows `settings.ts`'s rules, because it is persisted through it:
 * every leaf `catch`es, and one unreadable value costs only itself.
 *
 * One thing to know before changing it: `resourceKey` is the map key on disk.
 * Re-keying it - adding a component, reordering, changing the separator -
 * silently orphans every entry an older build wrote, and *that* would need a
 * `SETTINGS_VERSION` bump and a migration. Adding a `kind` does not; an unknown
 * kind simply fails its leaf and drops its own entry.
 */
import { z } from "zod";

import { recordOfEach } from "./persisted.ts";

/**
 * What can be remembered.
 *
 * Deliberately not "anything with an ARN": a thing is here because there is a
 * page that shows it and a reason to come back to it.
 */
export const RESOURCE_KINDS = [
  "s3-bucket",
  "s3-prefix",
  "ec2-instance",
  "ecs-cluster",
  "ecs-service",
  "ssh-host",
  "kube-context",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * Which account, region and endpoint a resource belongs to.
 *
 * Stored rather than implied, so entries from one account can be *hidden*
 * rather than deleted when the scope moves. Switching profiles for an hour and
 * switching back should not cost you the list you built up.
 */
export const resourceScopeSchema = z.object({
  profile: z.string().max(200).catch(""),
  region: z.string().max(64).catch(""),
  /** Empty means AWS; otherwise the id of a saved S3 endpoint. */
  connectionId: z.string().max(200).catch(""),
});

export type ResourceScope = z.infer<typeof resourceScopeSchema>;

const EMPTY_SCOPE = (): ResourceScope => resourceScopeSchema.parse({});

/** Enough to draw a row and to navigate back to what it names. */
export const resourceRefSchema = z.object({
  kind: z.enum(RESOURCE_KINDS),
  /** The ARN where one exists, and the natural key where one does not. */
  id: z.string().min(1).max(2048),
  label: z.string().min(1).max(200),
  /** The second line: a cluster name, a prefix, an instance id. */
  detail: z.string().max(400).catch(""),
  scope: resourceScopeSchema.default(EMPTY_SCOPE).catch(EMPTY_SCOPE),
  /** A router path with its search already encoded, so a row is one `navigate`. */
  to: z.string().min(1).max(2048),
});

export type ResourceRef = z.infer<typeof resourceRefSchema>;

/**
 * A ref with the moment it was recorded.
 *
 * `at` is an ISO string rather than a `Date` for the reason `silenceEntry`
 * gives: this travels over Socket.IO as well as tRPC, and only tRPC has
 * superjson, so a `Date` would arrive as two different things.
 */
export const recentEntrySchema = resourceRefSchema.extend({ at: z.string().min(1) });

export type RecentEntry = z.infer<typeof recentEntrySchema>;

const refMapSchema = recordOfEach(recentEntrySchema);

export const recentsSettingsSchema = z.object({
  /** Everywhere you have been, newest write wins. */
  visited: refMapSchema,
  /** Everywhere you said to keep, until you say otherwise. */
  pinned: refMapSchema,
});

export type RecentsSettings = z.infer<typeof recentsSettingsSchema>;

/**
 * NUL, which cannot occur in an ARN, a bucket name, a profile or a region.
 *
 * Written as an escape rather than as a raw byte: a raw NUL in source makes
 * `file(1)` call the file `data`, and `grep` then skips it without saying so.
 */
const SEPARATOR = "\x00";

/**
 * The map key for a ref.
 *
 * Scope is part of the identity rather than a field beside it, because the same
 * bucket name in two accounts is two different buckets and a natural key like
 * `my-data` would otherwise have one of them overwrite the other. An ARN would
 * not need this; half of these kinds have no ARN.
 */
export function resourceKey(ref: ResourceRef): string {
  return [ref.kind, ref.scope.profile, ref.scope.region, ref.scope.connectionId, ref.id].join(
    SEPARATOR,
  );
}

/**
 * The five things a person can do to what the app remembers.
 *
 * `at` is server-assigned and so is not an input, exactly as with
 * `silenceOpSchema`: a client with a wrong clock would otherwise decide which
 * entries get evicted when the map fills, and would make its own rows sort to
 * the top of everyone else's list forever.
 */
export const recentOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("record"), ref: resourceRefSchema }),
  z.object({ op: z.literal("pin"), ref: resourceRefSchema }),
  z.object({ op: z.literal("unpin"), key: z.string().min(1) }),
  z.object({ op: z.literal("forget"), key: z.string().min(1) }),
  z.object({
    op: z.literal("forgetAll"),
    target: z.enum(["visited", "pinned", "both"]).default("visited"),
  }),
]);

export type RecentOp = z.infer<typeof recentOpSchema>;

/** Enough history to cover a working week without the file becoming a log. */
export const MAX_RECENT_ENTRIES = 200;
/** A pin list is curated by hand; this only stops a script running away with it. */
export const MAX_PINNED_ENTRIES = 100;

/**
 * Trims each map to its cap, oldest first.
 *
 * On write rather than in the schema, for the reason `pruneSilenced` gives: a
 * schema rule would *reject* an over-full file, and the only sane answer to too
 * many entries is to drop the stalest, not to refuse to read any of them.
 */
export function pruneRecents(recents: RecentsSettings): RecentsSettings {
  return {
    visited: pruneMap(recents.visited, MAX_RECENT_ENTRIES),
    pinned: pruneMap(recents.pinned, MAX_PINNED_ENTRIES),
  };
}

function pruneMap(map: Record<string, RecentEntry>, cap: number): Record<string, RecentEntry> {
  const entries = Object.entries(map);
  if (entries.length <= cap) return map;
  entries.sort(([, a], [, b]) => b.at.localeCompare(a.at));
  return Object.fromEntries(entries.slice(0, cap));
}

/**
 * The five operations, as pure data.
 *
 * `record` touches only `visited`. A pin is a deliberate act with its own
 * timestamp - the moment you decided to keep this - and re-stamping it every
 * time you walked past would turn the pinned list into a second recents list
 * sorted the same way, which is the one thing pinning exists not to be.
 *
 * `forget` clears the key from both maps, matching what the button says: the
 * person asked the app to stop remembering this, not to unpick which of the two
 * mechanisms was holding onto it. This is the same call `restore` makes.
 */
export function applyRecentOp(current: RecentsSettings, op: RecentOp, at: Date): RecentsSettings {
  switch (op.op) {
    case "record": {
      const entry: RecentEntry = { ...op.ref, at: at.toISOString() };
      return { ...current, visited: { ...current.visited, [resourceKey(op.ref)]: entry } };
    }
    case "pin": {
      const entry: RecentEntry = { ...op.ref, at: at.toISOString() };
      return { ...current, pinned: { ...current.pinned, [resourceKey(op.ref)]: entry } };
    }
    case "unpin": {
      const { [op.key]: _removed, ...pinned } = current.pinned;
      return { ...current, pinned };
    }
    case "forget": {
      const { [op.key]: _visited, ...visited } = current.visited;
      const { [op.key]: _pinned, ...pinned } = current.pinned;
      return { visited, pinned };
    }
    case "forgetAll":
      return {
        visited: op.target === "pinned" ? current.visited : {},
        pinned: op.target === "visited" ? current.pinned : {},
      };
  }
}

/**
 * Whether an entry belongs to the scope currently in view.
 *
 * Applied when reading rather than when writing, which is what makes switching
 * accounts non-destructive: the rows from the other profile are still in the
 * file, and they come back the moment you switch back.
 *
 * An entry with no profile is unscoped and always shown. Some things are not
 * reached through an AWS account at all - an SSH host is reached from this
 * machine - and an entry whose scope was unreadable lands here too, which is
 * the right way round: a row that is always visible can be forgotten, and one
 * that is never visible cannot.
 *
 * `connectionId` is only compared for the S3 kinds. It is the endpoint S3 calls
 * are pointed at and has no bearing on an ECS cluster, so comparing it
 * everywhere would hide every ECS row the moment a non-AWS endpoint was picked.
 */
export function inScope(entry: ResourceRef, scope: ResourceScope): boolean {
  if (entry.scope.profile.length === 0) return true;
  if (entry.scope.profile !== scope.profile) return false;
  if (entry.scope.region !== scope.region) return false;
  if (!entry.kind.startsWith("s3-")) return true;
  return entry.scope.connectionId === scope.connectionId;
}
