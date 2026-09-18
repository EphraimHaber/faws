/**
 * The one place user preferences live.
 *
 * Memory is authoritative once `load()` has run; the file is a projection of
 * it, written behind the caller. That shape falls out of what the UI does with
 * these values: a gutter drag calls `update` on every pointermove, so a
 * caller that had to await a disk to see its own change would feel the disk.
 * Mutators are synchronous, return the new snapshot, and schedule a write.
 *
 * **Single writer, last writer wins.** Nothing here locks the file. Two server
 * processes sharing one data directory would overwrite each other wholesale,
 * and that is accepted rather than defended against: dev runs out of
 * `~/.faws-dev` and the packaged app out of Electron's userData, so the case
 * only arises if someone points two servers at the same `FAWS_DATA_DIR` by
 * hand.
 *
 * **A file that cannot be written is not an error.** Preferences keep working
 * from memory for the life of the process, live sync between windows keeps
 * working because it never touches disk, and the only thing lost is survival
 * across a restart. Every snapshot carries `persistence` so the UI can say so.
 */
import {
  DEFAULT_SETTINGS,
  pruneSilenced,
  SETTINGS_VERSION,
  type SettingsPatch,
  type Settings,
  type SettingsSnapshot,
  type SilenceEntry,
  type SilenceOp,
  type SilencedSettings,
  settingsSchema,
} from "@faws/contracts";

import { createLogger } from "../../shared/logger.ts";
import { migrateToCurrent, readVersion } from "./migrations.ts";
import {
  describeError,
  probeWritable,
  readSettingsFile,
  writeSettingsFileAtomic,
} from "./settings.file.ts";

/**
 * Long enough to swallow a pointermove burst, short enough that quitting
 * immediately after a click keeps the click.
 */
const WRITE_DEBOUNCE_MS = 150;
/** A sustained drag still reaches the disk about once a second. */
const WRITE_MAX_DEFER_MS = 1000;
/** A drag against a read-only volume must not emit a log line per frame. */
const ERROR_LOG_INTERVAL_MS = 60_000;

export type SettingsListener = (snapshot: SettingsSnapshot, originId: string | null) => void;

export interface SettingsStore {
  /** Reads the file, migrates it, probes writability. Call once, before listen. */
  load(): Promise<SettingsSnapshot>;
  get(): SettingsSnapshot;
  update(patch: SettingsPatch, originId?: string | null): SettingsSnapshot;
  applySilence(op: SilenceOp, originId?: string | null): SettingsSnapshot;
  /**
   * Adopts preferences a browser had in `localStorage` before this existed.
   * A no-op unless the store is still pristine, so two tabs racing to import
   * is harmless - the second one loses and can see that it did.
   */
  importLegacy(
    patch: SettingsPatch,
    silenced: Partial<SilencedSettings>,
    originId?: string | null,
  ): { snapshot: SettingsSnapshot; imported: boolean };
  reset(originId?: string | null): SettingsSnapshot;
  subscribe(listener: SettingsListener): () => void;
  /** Awaits any pending write. For the shutdown path and for tests. */
  flush(): Promise<void>;
}

export interface SettingsStoreOptions {
  readonly file: string;
  readonly now?: () => Date;
  /** Injected by tests to drive the read-only path without a read-only disk. */
  readonly write?: (file: string, data: unknown) => Promise<void>;
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  const log = createLogger("settings");
  const now = options.now ?? (() => new Date());
  const write = options.write ?? writeSettingsFileAtomic;

  let settings: Settings = DEFAULT_SETTINGS;
  let revision = 0;
  let pristine = true;
  let writable = true;
  let reason: string | null = null;
  /**
   * Set only for a file a newer faws wrote. Distinct from `!writable`: a write
   * that failed should be retried on the next change, because an ENOSPC or a
   * remounted volume heals on its own. Refusing to downgrade never heals, and
   * retrying it would eventually clobber the newer file.
   */
  let frozen = false;
  const listeners = new Set<SettingsListener>();

  let dirty = false;
  let flushing: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let firstDirtyAt = 0;
  let lastErrorLoggedAt = 0;

  function snapshot(): SettingsSnapshot {
    return { settings, revision, persistence: { writable, reason }, pristine };
  }

  function commit(next: Settings, originId: string | null): SettingsSnapshot {
    settings = next;
    revision += 1;
    pristine = false;
    const snap = snapshot();
    for (const listener of listeners) {
      try {
        listener(snap, originId);
      } catch (err) {
        log.warn({ err }, "settings listener threw");
      }
    }
    scheduleFlush();
    return snap;
  }

  function scheduleFlush(): void {
    if (frozen) return;
    dirty = true;
    if (firstDirtyAt === 0) firstDirtyAt = Date.now();
    // Past the ceiling the trailing timer has been pushed back too many times
    // already; write now and start a fresh window.
    if (Date.now() - firstDirtyAt >= WRITE_MAX_DEFER_MS) {
      clearTimer();
      void runFlush();
      return;
    }
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void runFlush();
    }, WRITE_DEBOUNCE_MS);
    timer.unref?.();
  }

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  /**
   * One write at a time, coalescing whatever arrived during the last one.
   *
   * The `while (dirty)` loop is what serializes: a change landing mid-write
   * sets the flag instead of starting a second write, so two writes never
   * interleave and at most one extra write trails a burst.
   */
  function runFlush(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      while (dirty) {
        dirty = false;
        firstDirtyAt = 0;
        const attempt = settings;
        try {
          await write(options.file, attempt);
          if (!writable) {
            writable = true;
            reason = null;
            log.info("settings are writable again");
            notifyPersistence();
          }
        } catch (err) {
          const message = describeError(err);
          const changed = writable || reason !== message;
          writable = false;
          reason = message;
          const at = Date.now();
          if (changed || at - lastErrorLoggedAt >= ERROR_LOG_INTERVAL_MS) {
            lastErrorLoggedAt = at;
            log.error({ err, file: options.file }, "could not write settings");
          }
          if (changed) notifyPersistence();
        }
      }
      flushing = null;
    })();
    return flushing;
  }

  /** A writability change is a settings change as far as the UI is concerned. */
  function notifyPersistence(): void {
    const snap = snapshot();
    for (const listener of listeners) {
      try {
        listener(snap, null);
      } catch {
        /* already logged on the commit path */
      }
    }
  }

  return {
    async load() {
      let result;
      try {
        result = await readSettingsFile(options.file);
      } catch (err) {
        log.error({ err, file: options.file }, "could not read settings");
        writable = false;
        reason = describeError(err);
        return snapshot();
      }

      if (result.corruptedTo) {
        log.error(
          { file: options.file, movedTo: result.corruptedTo },
          "settings file was unreadable and has been moved aside",
        );
      }

      if (result.raw) {
        const fileVersion = readVersion(result.raw);
        if (fileVersion > SETTINGS_VERSION) {
          // Serve what this build understands, but never write: rewriting
          // would silently discard preferences a newer faws made, and that is
          // the one failure here that cannot be undone.
          settings = settingsSchema.parse(result.raw);
          pristine = false;
          writable = false;
          frozen = true;
          reason = `settings.json was written by a newer version of faws (v${fileVersion})`;
          log.warn({ fileVersion, supported: SETTINGS_VERSION }, reason);
          return snapshot();
        }

        const migrated = migrateToCurrent(result.raw);
        settings = settingsSchema.parse(migrated.data);
        pristine = false;
        const probe = await probeWritable(options.file);
        if (probe) {
          writable = false;
          reason = probe;
          log.warn({ file: options.file, reason: probe }, "settings cannot be saved");
        } else if (migrated.applied.length > 0) {
          // Write the upgrade back once so the next start is a plain read.
          log.info({ from: migrated.from, to: SETTINGS_VERSION }, "migrated settings");
          scheduleFlush();
        }
        return snapshot();
      }

      // Missing or quarantined: start from defaults and write nothing. A file
      // appears the first time someone changes something, which keeps a
      // read-only home directory quiet on every run rather than on none.
      settings = DEFAULT_SETTINGS;
      pristine = result.missing;
      const probe = await probeWritable(options.file);
      if (probe) {
        writable = false;
        reason = probe;
        log.warn({ file: options.file, reason: probe }, "settings cannot be saved");
      }
      return snapshot();
    },

    get: snapshot,

    update(patch, originId = null) {
      return commit(applyPatch(settings, patch), originId);
    },

    applySilence(op, originId = null) {
      const silenced = applySilenceOp(settings.silenced, op, now());
      return commit({ ...settings, silenced: pruneSilenced(silenced) }, originId);
    },

    importLegacy(patch, silenced, originId = null) {
      if (!pristine) {
        log.info("skipped legacy settings import: settings already exist");
        return { snapshot: snapshot(), imported: false };
      }
      const merged = applyPatch(settings, patch);
      const next: Settings = {
        ...merged,
        silenced: pruneSilenced({
          dismissed: { ...merged.silenced.dismissed, ...silenced.dismissed },
          muted: { ...merged.silenced.muted, ...silenced.muted },
        }),
      };
      log.info(
        {
          dismissed: Object.keys(next.silenced.dismissed).length,
          muted: Object.keys(next.silenced.muted).length,
          sections: Object.keys(patch),
        },
        "imported legacy settings from localStorage",
      );
      return { snapshot: commit(next, originId), imported: true };
    },

    reset(originId = null) {
      return commit(DEFAULT_SETTINGS, originId);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async flush() {
      clearTimer();
      if (dirty || flushing) await runFlush();
    },
  };
}

/**
 * Merges a patch section by section.
 *
 * Shallow within a section on purpose: sections hold scalars, so a spread is
 * the whole story, and a deep merge would only create somewhere for a future
 * nested field to behave differently from every field above it.
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

/**
 * The four silence operations, as pure data.
 *
 * `restore` clears the ARN from both maps, matching what the button says: the
 * person asked to see this resource again, not to unpick which of the two
 * mechanisms was hiding it.
 */
export function applySilenceOp(
  current: SilencedSettings,
  op: SilenceOp,
  at: Date,
): SilencedSettings {
  switch (op.op) {
    case "dismiss": {
      const entry: SilenceEntry = { ...op.entry, at: at.toISOString() };
      return { ...current, dismissed: { ...current.dismissed, [entry.arn]: entry } };
    }
    case "mute": {
      const entry: SilenceEntry = { ...op.entry, at: at.toISOString() };
      return { ...current, muted: { ...current.muted, [entry.arn]: entry } };
    }
    case "restore": {
      const { [op.arn]: _dismissed, ...dismissed } = current.dismissed;
      const { [op.arn]: _muted, ...muted } = current.muted;
      return { dismissed, muted };
    }
    case "restoreAll":
      return { dismissed: {}, muted: {} };
  }
}
