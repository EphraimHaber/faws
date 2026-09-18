/**
 * Adopting the preferences a browser was holding before the server owned them.
 *
 * Runs once, on the first load that finds the server with nothing stored. What
 * it is protecting is the silence list: dismissals and mutes are the product
 * of real knowledge about which alarms belong to somebody else, and losing
 * them on upgrade would be the kind of small betrayal people remember.
 *
 * Two rules it would be easy to get wrong:
 *
 * - **Only keys that are actually present are sent.** An absent key means
 *   "this browser never had an opinion", and sending its default instead would
 *   overwrite a value the server may already have.
 * - **The old schemas are copied here, not imported.** They describe what the
 *   previous version of this app wrote, which is a historical fact. Importing
 *   today's schema would mean deleting a default somewhere else silently
 *   changes what an old browser's values turn into.
 */
import type { SettingsPatch, SilencedSettings } from "@faws/contracts";
import { z } from "zod";

import { readStored } from "~/lib/stored";

/** Every key the renderer used to own, in the shapes it used to write. */
const LEGACY_KEYS = [
  "faws:profile",
  "faws:region",
  "faws:refresh",
  "faws:logTimestamps",
  "faws:logGutter",
  "faws:logTaskGutter",
  "faws:theme",
  "faws:terminal:height",
  "faws:terminal:record",
  "faws:silenced",
] as const;

/** Where the old values are parked for one release, in case this goes wrong. */
const BACKUP_KEY = "faws:legacy-backup";

const legacySilenceEntry = z.object({
  arn: z.string().min(1),
  label: z.string().catch(""),
  context: z.string().catch(""),
  fingerprint: z.string().optional(),
  at: z.string().min(1),
});

/** zustand's `persist` wrote `{ state, version }`, not the bare state. */
const legacySilenced = z.object({
  state: z
    .object({
      dismissed: z.record(z.string(), legacySilenceEntry).catch({}),
      muted: z.record(z.string(), legacySilenceEntry).catch({}),
    })
    .catch({ dismissed: {}, muted: {} }),
});

export interface LegacyImport {
  readonly patch: SettingsPatch;
  readonly silenced: Partial<SilencedSettings>;
  /** The keys that were found, so only those are cleared afterwards. */
  readonly keys: ReadonlyArray<string>;
}

/** Null when this browser has nothing to hand over. */
export function collectLegacySettings(): LegacyImport | null {
  const found: string[] = [];
  const scope: Record<string, unknown> = {};
  const logs: Record<string, unknown> = {};
  const appearance: Record<string, unknown> = {};
  const terminal: Record<string, unknown> = {};
  const silenced: Partial<SilencedSettings> = {};

  const raw = (key: string): string | null => {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) found.push(key);
      return value;
    } catch {
      return null;
    }
  };

  if (raw("faws:profile") !== null) {
    scope["profile"] = readStored("faws:profile", z.string().min(1).catch("default"));
  }
  if (raw("faws:region") !== null) {
    scope["region"] = readStored("faws:region", z.string().catch(""));
  }
  if (raw("faws:refresh") !== null) {
    scope["refreshSeconds"] = readStored("faws:refresh", z.coerce.number().catch(30));
  }
  if (raw("faws:logTimestamps") !== null) {
    logs["timestamps"] = readStored("faws:logTimestamps", z.enum(["clock", "full"]).catch("clock"));
  }
  if (raw("faws:logGutter") !== null) {
    logs["gutter"] = readStored("faws:logGutter", z.coerce.number().int().catch(68));
  }
  if (raw("faws:logTaskGutter") !== null) {
    logs["taskGutter"] = readStored("faws:logTaskGutter", z.coerce.number().int().catch(128));
  }
  if (raw("faws:theme") !== null) {
    appearance["theme"] = readStored("faws:theme", z.enum(["light", "dark"]).catch("dark"));
  }
  if (raw("faws:terminal:height") !== null) {
    terminal["dockHeight"] = readStored("faws:terminal:height", z.coerce.number().int().catch(280));
  }
  if (raw("faws:terminal:record") !== null) {
    // It was stored as "1" / "0"; anything other than "0" meant on.
    terminal["recordByDefault"] = readStored(
      "faws:terminal:record",
      z
        .string()
        .transform((value) => value !== "0")
        .catch(true),
    );
  }

  const silencedBlob = raw("faws:silenced");
  if (silencedBlob !== null) {
    try {
      const parsed = legacySilenced.parse(JSON.parse(silencedBlob));
      if (Object.keys(parsed.state.dismissed).length > 0)
        silenced.dismissed = parsed.state.dismissed;
      if (Object.keys(parsed.state.muted).length > 0) silenced.muted = parsed.state.muted;
    } catch {
      /* an unreadable blob is one this version cannot honour; move on */
    }
  }

  if (found.length === 0) return null;

  const patch: SettingsPatch = {
    ...(Object.keys(scope).length > 0 ? { scope } : {}),
    ...(Object.keys(logs).length > 0 ? { logs } : {}),
    ...(Object.keys(appearance).length > 0 ? { appearance } : {}),
    ...(Object.keys(terminal).length > 0 ? { terminal } : {}),
  } as SettingsPatch;

  return { patch, silenced, keys: found };
}

/**
 * Archives the old values under one key, then removes them.
 *
 * Removing matters: left in place, any future regression in the import
 * condition would re-adopt values that are by then months stale, and a person
 * looking at devtools would edit a key that no longer does anything. The
 * archive is a one-release safety net, not a fixture.
 */
export function clearLegacyKeys(keys: ReadonlyArray<string>): void {
  try {
    const archive: Record<string, string> = {};
    for (const key of keys) {
      const value = window.localStorage.getItem(key);
      if (value !== null) archive[key] = value;
    }
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify(archive));
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    /* blocked storage: there was nothing to clear anyway */
  }
}

export { BACKUP_KEY, LEGACY_KEYS };
