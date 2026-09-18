/**
 * The preferences the server persists, and the shapes for changing them.
 *
 * These used to be a dozen independent `localStorage` keys in the renderer.
 * They live here because the server now owns them: it parses this schema when
 * it reads the file, the tRPC procedures validate writes with the patch and
 * op schemas below, and the renderer builds its state from the same types.
 *
 * Two conventions run through the whole file:
 *
 * - **Every leaf `catch`es.** A settings file outlives the code that wrote it
 *   and a person can edit it by hand, so a stored value is untrusted input.
 *   The `catch` fallback is the single definition of that preference's
 *   default; there is no second copy at any call site to drift from it.
 * - **Sections default too**, so a section that is missing, null, or replaced
 *   by a string still yields a fully-populated one rather than taking the
 *   surrounding parse down with it.
 *
 * The consequence worth stating plainly: one garbage value costs only itself.
 * Nothing in this file can reject a settings file - only `JSON.parse` can, and
 * that is handled as corruption by the loader.
 */
import { z } from "zod";

/**
 * Bumped whenever a migration is needed to read an older file. Contracts owns
 * it rather than the server because the renderer's first-paint cache is parsed
 * with this same schema and has to agree about what shape it is looking at.
 */
export const SETTINGS_VERSION = 1;

/** -1 means "never auto-refresh", matching e1s's `--refresh -1`. */
export const REFRESH_CHOICES = [-1, 10, 30, 60, 300] as const;
export const DEFAULT_REFRESH_SECONDS = 30;

/** Narrower than this and the column is a stripe, not a timestamp. */
export const MIN_LOG_GUTTER = 36;
/** Wide enough for a clock time, which is what the pane opens with. */
export const DEFAULT_LOG_GUTTER = 68;
/** Wide enough for the truncated tail of a task id. */
export const DEFAULT_LOG_TASK_GUTTER = 128;

/** Below this the dock is a strip with no room for a prompt. */
export const MIN_DOCK_HEIGHT = 120;
export const DEFAULT_DOCK_HEIGHT = 280;

/** Clock time is enough to follow a tail; the full stamp is what you paste
 *  into a ticket or line up against another system's clock. */
export type LogTimestamps = "clock" | "full";
export type Theme = "light" | "dark";

function isRefreshChoice(n: number): boolean {
  return (REFRESH_CHOICES as ReadonlyArray<number>).includes(n);
}

/**
 * A section that survives being absent or being the wrong type entirely.
 *
 * `default({})` covers absent; `catch` covers "present but not an object",
 * re-parsing an empty object so the result is the section's own defaults
 * rather than a hand-written duplicate of them.
 */
// The casts are the price of writing this once for five sections: zod's
// `default`/`catch` signatures cannot see that a generic object schema's
// fallback is its own output type.
function section<T extends z.ZodObject<z.ZodRawShape>>(shape: T): z.ZodCatch<z.ZodDefault<T>> {
  const fallback = () => shape.parse({});
  return shape.default(fallback as never).catch(fallback as never) as z.ZodCatch<z.ZodDefault<T>>;
}

/**
 * One silenced warning.
 *
 * `at` is an ISO string rather than a `Date` deliberately: this object travels
 * over Socket.IO as well as tRPC, and only the tRPC side has superjson. A
 * `Date` here would arrive as a string on one path and a `Date` on the other.
 */
export const silenceEntrySchema = z.object({
  arn: z.string().min(1).max(2048),
  label: z.string().max(200).catch(""),
  context: z.string().max(400).catch(""),
  /** Present for dismissals; absent for mutes. */
  fingerprint: z.string().max(200).optional(),
  at: z.string().min(1),
});

export type SilenceEntry = z.infer<typeof silenceEntrySchema>;

const silenceMapSchema = z.record(z.string(), silenceEntrySchema).catch({});

export const scopeSettingsSchema = z.object({
  profile: z.string().min(1).catch("default"),
  /** Empty means "ask the CLI what this profile's default region is". */
  region: z.string().catch(""),
  refreshSeconds: z.number().refine(isRefreshChoice).catch(DEFAULT_REFRESH_SECONDS),
});

export const logSettingsSchema = z.object({
  timestamps: z.enum(["clock", "full"]).catch("clock"),
  gutter: z.number().int().min(MIN_LOG_GUTTER).catch(DEFAULT_LOG_GUTTER),
  taskGutter: z.number().int().min(MIN_LOG_GUTTER).catch(DEFAULT_LOG_TASK_GUTTER),
});

export const appearanceSettingsSchema = z.object({
  /** Dark-first: this tool lives next to a terminal. */
  theme: z.enum(["light", "dark"]).catch("dark"),
});

export const terminalSettingsSchema = z.object({
  dockHeight: z.number().int().min(MIN_DOCK_HEIGHT).catch(DEFAULT_DOCK_HEIGHT),
  recordByDefault: z.boolean().catch(true),
});

export const silencedSettingsSchema = z.object({
  /** Per-incident, keyed by ARN; comes back when the fingerprint changes. */
  dismissed: silenceMapSchema,
  /** Per-resource, keyed by ARN; lasts until explicitly restored. */
  muted: silenceMapSchema,
});

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION).catch(SETTINGS_VERSION),
  scope: section(scopeSettingsSchema),
  logs: section(logSettingsSchema),
  appearance: section(appearanceSettingsSchema),
  terminal: section(terminalSettingsSchema),
  silenced: section(silencedSettingsSchema),
});

export type Settings = z.infer<typeof settingsSchema>;
export type ScopeSettings = Settings["scope"];
export type LogSettings = Settings["logs"];
export type TerminalSettings = Settings["terminal"];
export type SilencedSettings = Settings["silenced"];

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/**
 * A change to one or more sections, merged into what the server already has.
 *
 * A whole-object write would make every change a read-modify-write across the
 * network, so two open windows would clobber each other's unrelated
 * preferences. A generic `{ path, value }` patch would work too, but it throws
 * away the type at the boundary, which is the one thing this package exists to
 * avoid.
 *
 * `silenced` is deliberately absent: "forget this ARN" cannot be expressed as
 * a merge, and shipping the whole map on every toggle would reintroduce the
 * clobbering for the field most likely to be edited from two windows. It gets
 * `silenceOpSchema` instead, and `strict()` turns an attempt to slip it
 * through here into a validation error rather than a silent no-op.
 */
export const settingsPatchSchema = z
  .object({
    scope: scopeSettingsSchema.partial(),
    logs: logSettingsSchema.partial(),
    appearance: appearanceSettingsSchema.partial(),
    terminal: terminalSettingsSchema.partial(),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/**
 * The four things a person can do to a silenced warning.
 *
 * `at` is server-assigned, so it is not in the inputs: a client clock that is
 * wrong would otherwise decide which entries get evicted when the map fills.
 */
export const silenceOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("dismiss"), entry: silenceEntrySchema.omit({ at: true }) }),
  z.object({
    op: z.literal("mute"),
    entry: silenceEntrySchema.omit({ at: true, fingerprint: true }),
  }),
  z.object({ op: z.literal("restore"), arn: z.string().min(1) }),
  z.object({ op: z.literal("restoreAll") }),
]);

export type SilenceOp = z.infer<typeof silenceOpSchema>;

/**
 * Per map. A mute list is curated by hand and never gets near this; the cap is
 * here so a script looping over a large account cannot grow the file without
 * bound.
 */
export const MAX_SILENCE_ENTRIES = 500;

/**
 * Trims each map to the cap, oldest first.
 *
 * Applied on write rather than expressed in the schema on purpose: a schema
 * rule would *reject* an over-full file, and the only sane response to too
 * many entries is to drop the stalest ones, not to refuse to read anything.
 */
export function pruneSilenced(silenced: SilencedSettings): SilencedSettings {
  return {
    dismissed: pruneMap(silenced.dismissed),
    muted: pruneMap(silenced.muted),
  };
}

function pruneMap(map: Record<string, SilenceEntry>): Record<string, SilenceEntry> {
  const entries = Object.entries(map);
  if (entries.length <= MAX_SILENCE_ENTRIES) return map;
  entries.sort(([, a], [, b]) => b.at.localeCompare(a.at));
  return Object.fromEntries(entries.slice(0, MAX_SILENCE_ENTRIES));
}

/**
 * Merges a patch into a full settings object, section by section.
 *
 * Shared by the server (which owns the file) and the renderer (which applies
 * the same change optimistically before sending it): two implementations of
 * "what this patch means" would drift, and the drift would show up as the UI
 * and the disk disagreeing about one field.
 */
export function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  return {
    ...current,
    scope: mergeSection(current.scope, patch.scope),
    logs: mergeSection(current.logs, patch.logs),
    appearance: mergeSection(current.appearance, patch.appearance),
    terminal: mergeSection(current.terminal, patch.terminal),
  };
}

/**
 * A plain spread would let an explicit `undefined` in the patch punch a hole
 * in the section, which `JSON.stringify` then drops and the next load fills
 * with a default - a preference silently reset by a key that was only ever
 * meant to be absent.
 */
function mergeSection<T extends object>(
  current: T,
  patch: { [K in keyof T]?: T[K] | undefined } | undefined,
): T {
  if (!patch) return current;
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key as keyof T] = value as T[keyof T];
  }
  return next;
}

/** Whether a settings file can still be written back to disk. */
export interface SettingsPersistence {
  readonly writable: boolean;
  /** Why not, errno included, for the notice the Settings page shows. */
  readonly reason: string | null;
}

/**
 * What every read, write and broadcast of settings carries.
 *
 * One shape for all three so the client has a single apply path, and so a
 * reconnect is indistinguishable from an update.
 */
export interface SettingsSnapshot {
  readonly settings: Settings;
  /**
   * Monotonic within one server process, reset by a restart.
   *
   * It exists so a client can drop a stale write: during a gutter drag, the
   * HTTP response to update N can land after N+2 has already been applied
   * locally, and applying it snaps the column backwards.
   */
  readonly revision: number;
  readonly persistence: SettingsPersistence;
  /** Nothing has ever been written. Gates the one-time localStorage import. */
  readonly pristine: boolean;
}

/** Carries the `originId` so the window that caused it can ignore the echo. */
export interface SettingsChangedPayload extends SettingsSnapshot {
  readonly originId: string | null;
}
