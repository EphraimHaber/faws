/**
 * The preferences the server persists, and the shapes for changing them.
 *
 * They live here because the server owns them, not the renderer's
 * `localStorage`: it parses this schema when it reads the file, the tRPC procedures validate writes with the patch and
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

import { recordOfEach } from "./persisted.ts";
import { manifestFor, type ProviderId } from "./providers.ts";
import { recentsSettingsSchema } from "./recents.ts";
import { s3ConnectionSchema } from "./s3-connections.ts";
import { tablesSettingsSchema } from "./tables.ts";
import { trustSettingsSchema } from "./trust.ts";

/**
 * Bumped whenever a migration is needed to read an older file. Contracts owns
 * it rather than the server because the renderer's first-paint cache is parsed
 * with this same schema and has to agree about what shape it is looking at.
 *
 * Adding a section is not such a change: an older file reads back with the new
 * section's defaults, and a newer file's extra section is ignored by an older
 * build. What *would* need a bump is a change to how `recents` keys its maps,
 * because that orphans entries rather than defaulting them - see `resourceKey`.
 */
export const SETTINGS_VERSION = 1;

/** -1 means "never auto-refresh", matching e1s's `--refresh -1`. */
export const REFRESH_CHOICES = [-1, 10, 30, 60, 300] as const;
export const DEFAULT_REFRESH_SECONDS = 30;

/** How long a finished deploy stays on screen, in seconds; 0 hides it the moment it settles. */
export const DEPLOYED_LINGER_CHOICES = [0, 30, 120, 300, 600] as const;
export const DEFAULT_DEPLOYED_LINGER_SECONDS = 120;

/** Narrower than this and the column is a stripe, not a timestamp. */
export const MIN_LOG_GUTTER = 36;
/** Wide enough for a clock time, which is what the pane opens with. */
export const DEFAULT_LOG_GUTTER = 68;
/** Wide enough for the truncated tail of a task id. */
export const DEFAULT_LOG_TASK_GUTTER = 128;

/** Below this the dock is a strip with no room for a prompt. */
export const MIN_DOCK_HEIGHT = 120;
export const DEFAULT_DOCK_HEIGHT = 280;

/** Narrower than this and a cluster name is an ellipsis with a dot beside it. */
export const MIN_SIDEBAR_WIDTH = 180;
/**
 * Capped because the rail is navigation, not content: past this it is taking
 * room from the thing being read without showing anything more of itself.
 */
export const MAX_SIDEBAR_WIDTH = 480;
/** `w-64`. */
export const DEFAULT_SIDEBAR_WIDTH = 256;

/** Clock time is enough to follow a tail; the full stamp is what you paste
 *  into a ticket or line up against another system's clock. */
export type LogTimestamps = "clock" | "full";
export type Theme = "light" | "dark";

function isRefreshChoice(n: number): boolean {
  return (REFRESH_CHOICES as ReadonlyArray<number>).includes(n);
}

function isDeployedLingerChoice(n: number): boolean {
  return (DEPLOYED_LINGER_CHOICES as ReadonlyArray<number>).includes(n);
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

const silenceMapSchema = recordOfEach(silenceEntrySchema);

/** Which AWS account and region the AWS pages are looking at. */
export const awsScopeSettingsSchema = z.object({
  profile: z.string().min(1).catch("default"),
  /** Empty means "ask the CLI what this profile's default region is". */
  region: z.string().catch(""),
});

/** How often live lists poll, whichever provider they belong to. */
export const refreshSettingsSchema = z.object({
  seconds: z.number().refine(isRefreshChoice).catch(DEFAULT_REFRESH_SECONDS),
});

export const logSettingsSchema = z.object({
  timestamps: z.enum(["clock", "full"]).catch("clock"),
  gutter: z.number().int().min(MIN_LOG_GUTTER).catch(DEFAULT_LOG_GUTTER),
  taskGutter: z.number().int().min(MIN_LOG_GUTTER).catch(DEFAULT_LOG_TASK_GUTTER),
});

/**
 * How the shell's own panes are sized.
 *
 * Separate from `appearance`, which is about how things look rather than how
 * much room they take, and separate from `terminal`, which owns the dock's
 * height because the dock belongs to the terminal. The sidebar belongs to the
 * shell.
 */
export const layoutSettingsSchema = z.object({
  sidebarWidth: z
    .number()
    .int()
    .min(MIN_SIDEBAR_WIDTH)
    .max(MAX_SIDEBAR_WIDTH)
    .catch(DEFAULT_SIDEBAR_WIDTH),
});

export const appearanceSettingsSchema = z.object({
  /** Dark-first: this tool lives next to a terminal. */
  theme: z.enum(["light", "dark"]).catch("dark"),
});

export const terminalSettingsSchema = z.object({
  dockHeight: z.number().int().min(MIN_DOCK_HEIGHT).catch(DEFAULT_DOCK_HEIGHT),
  recordByDefault: z.boolean().catch(true),
  /**
   * Start SSM shells in bash rather than Session Manager's default `sh`.
   * Off by default, because the default is what `aws ssm start-session` gives.
   */
  ssmBash: z.boolean().catch(false),
});

/**
 * S3 endpoints that are not AWS.
 *
 * The records only: a key, a token or a passphrase belongs to none of this,
 * because this file is read by the renderer on first paint and broadcast to
 * every open window.
 */
/**
 * Parsed one entry at a time, because `array(...).catch([])` would answer a
 * single unreadable endpoint by dropping every endpoint. One that cannot be
 * read costs itself.
 */
export const s3ConnectionListSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = s3ConnectionSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  );

/**
 * Which context and namespace the Kubernetes pages are looking at.
 *
 * A different axis from AWS's profile and region entirely, which is why each
 * provider keeps its own scope: a profile switch leaves a pod list alone.
 *
 * Both empty by default, meaning "whatever the kubeconfig's own current-context
 * and namespace are". Storing a guess at those here would go stale the first
 * time someone ran `kubectl config use-context` in a terminal.
 */
export const kubeScopeSettingsSchema = z.object({
  context: z.string().catch(""),
  namespace: z.string().catch(""),
});

export const ecsSettingsSchema = z.object({
  deployedLingerSeconds: z
    .number()
    .refine(isDeployedLingerChoice)
    .catch(DEFAULT_DEPLOYED_LINGER_SECONDS),
});

function enabledFor(id: ProviderId) {
  return z.boolean().catch(manifestFor(id).defaultEnabled);
}

/**
 * One section per provider, keyed by its id: whether it is on, which of its
 * connections is in view, and anything else only it has an opinion about.
 *
 * `satisfies` holds the list to the manifests: a provider added to
 * `PROVIDER_MANIFESTS` without a section here fails to compile.
 */
const providerSections = {
  aws: section(
    z.object({
      /** Off means no page, query, menu entry or background call for it anywhere. */
      enabled: enabledFor("aws"),
      scope: section(awsScopeSettingsSchema),
    }),
  ),
  kubernetes: section(
    z.object({
      enabled: enabledFor("kubernetes"),
      scope: section(kubeScopeSettingsSchema),
    }),
  ),
  s3: section(
    z.object({
      enabled: enabledFor("s3"),
      /**
       * The records only: a key, a token or a passphrase belongs to none of
       * this, because this file is read by the renderer on first paint and
       * broadcast to every open window.
       */
      connections: s3ConnectionListSchema,
    }),
  ),
} satisfies Record<ProviderId, z.ZodType>;

export const providersSettingsSchema = z.object(providerSections);

/**
 * Whether the first-run screen has been through. Off until someone picks
 * which providers to use, or skips the choice.
 */
export const onboardingSettingsSchema = z.object({
  completed: z.boolean().catch(false),
});

/**
 * How the app keeps itself current.
 *
 * `autoCheck` off means the app never contacts GitHub on its own, which is
 * what an air-gapped or strictly on-prem install wants; "Check now" still
 * works when asked.
 */
export const updatesSettingsSchema = z.object({
  autoCheck: z.boolean().catch(true),
  /** `beta` also offers pre-releases. */
  channel: z.enum(["stable", "beta"]).catch("stable"),
  /** A version the user chose to skip; not offered again until a newer one. */
  skippedVersion: z.string().catch(""),
  /**
   * The newest version this install has been opened on, so the first launch
   * after an update can say what changed. Empty until the first launch.
   */
  lastSeenVersion: z.string().catch(""),
});

export const silencedSettingsSchema = z.object({
  /** Per-incident, keyed by ARN; comes back when the fingerprint changes. */
  dismissed: silenceMapSchema,
  /** Per-resource, keyed by ARN; lasts until explicitly restored. */
  muted: silenceMapSchema,
});

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION).catch(SETTINGS_VERSION),
  providers: section(providersSettingsSchema),
  onboarding: section(onboardingSettingsSchema),
  refresh: section(refreshSettingsSchema),
  updates: section(updatesSettingsSchema),
  trust: section(trustSettingsSchema),
  logs: section(logSettingsSchema),
  appearance: section(appearanceSettingsSchema),
  layout: section(layoutSettingsSchema),
  terminal: section(terminalSettingsSchema),
  ecs: section(ecsSettingsSchema),
  silenced: section(silencedSettingsSchema),
  recents: section(recentsSettingsSchema),
  tables: section(tablesSettingsSchema),
});

export type Settings = z.infer<typeof settingsSchema>;
export type LogSettings = Settings["logs"];
export type LayoutSettings = Settings["layout"];
export type TerminalSettings = Settings["terminal"];
export type EcsSettings = Settings["ecs"];
export type SilencedSettings = Settings["silenced"];
export type ProvidersSettings = Settings["providers"];
export type AwsScopeSettings = ProvidersSettings["aws"]["scope"];
export type KubeScopeSettings = ProvidersSettings["kubernetes"]["scope"];
export type RefreshSettings = Settings["refresh"];
export type UpdatesSettings = Settings["updates"];
export type TrustSettings = Settings["trust"];
export type OnboardingSettings = Settings["onboarding"];

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
 * `silenced`, `s3` and `recents` are deliberately absent: "forget this ARN",
 * "delete this endpoint" and "unpin this bucket" cannot be expressed as a
 * merge, and shipping the whole map or list on every change would reintroduce
 * the clobbering for the fields most likely to be edited from two windows. They
 * get `silenceOpSchema`, `s3ConnectionOpSchema` and `recentOpSchema` instead,
 * and `strict()` turns an attempt to slip one through here into a validation
 * error rather than a silent no-op.
 */
/**
 * What a patch may say about providers: on or off, and which connection is in
 * view. Saved S3 endpoints are a list and change through `s3ConnectionOpSchema`.
 */
const providersPatchSchema = z
  .object({
    aws: z.object({ enabled: z.boolean(), scope: awsScopeSettingsSchema.partial() }).partial(),
    kubernetes: z
      .object({ enabled: z.boolean(), scope: kubeScopeSettingsSchema.partial() })
      .partial(),
    s3: z.object({ enabled: z.boolean() }).partial(),
  } satisfies Record<ProviderId, z.ZodType>)
  .partial()
  .strict();

export const settingsPatchSchema = z
  .object({
    providers: providersPatchSchema,
    onboarding: onboardingSettingsSchema.partial(),
    refresh: refreshSettingsSchema.partial(),
    updates: updatesSettingsSchema.partial(),
    logs: logSettingsSchema.partial(),
    appearance: appearanceSettingsSchema.partial(),
    layout: layoutSettingsSchema.partial(),
    terminal: terminalSettingsSchema.partial(),
    ecs: ecsSettingsSchema.partial(),
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
    providers: mergeProviders(current.providers, patch.providers),
    onboarding: mergeSection(current.onboarding, patch.onboarding),
    refresh: mergeSection(current.refresh, patch.refresh),
    updates: mergeSection(current.updates, patch.updates),
    logs: mergeSection(current.logs, patch.logs),
    appearance: mergeSection(current.appearance, patch.appearance),
    layout: mergeSection(current.layout, patch.layout),
    terminal: mergeSection(current.terminal, patch.terminal),
    ecs: mergeSection(current.ecs, patch.ecs),
  };
}

function mergeProviders(
  current: ProvidersSettings,
  patch: SettingsPatch["providers"],
): ProvidersSettings {
  if (!patch) return current;
  return {
    aws: mergeProvider(current.aws, patch.aws),
    kubernetes: mergeProvider(current.kubernetes, patch.kubernetes),
    // Saved endpoints are the s3 provider's connections, chosen per page
    // rather than held as a scope, so only the switch is patched here.
    s3: { ...current.s3, enabled: patch.s3?.enabled ?? current.s3.enabled },
  };
}

function mergeProvider<T extends { enabled: boolean; scope: object }>(
  current: T,
  patch:
    | {
        enabled?: boolean | undefined;
        scope?: { [K in keyof T["scope"]]?: T["scope"][K] | undefined } | undefined;
      }
    | undefined,
): T {
  if (!patch) return current;
  return {
    ...current,
    enabled: patch.enabled ?? current.enabled,
    scope: mergeSection(current.scope, patch.scope),
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
