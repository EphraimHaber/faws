/**
 * Upgrading a settings file written by an older faws.
 *
 * The chain is deliberately dumb: each entry takes the raw object at version
 * `to - 1` and returns the raw object at version `to`, without consulting the
 * current schema. That is the whole discipline. A migration that reaches for
 * `settingsSchema` stops being a record of what changed and starts being a
 * mirror of today's code, which means it silently changes meaning every time
 * the schema does - and then the fixture tests that guard it prove nothing.
 *
 * Adding one: append `{ to: SETTINGS_VERSION }` here, bump `SETTINGS_VERSION`
 * in contracts, and drop a frozen copy of a real old file into
 * `__fixtures__/settings-v<previous>.json`. The structural test below fails
 * until the first two are done.
 */
import { SETTINGS_VERSION } from "@faws/contracts";

export interface Migration {
  /** The version this produces. Entries are contiguous, starting at 2. */
  readonly to: number;
  migrate(input: Record<string, unknown>): Record<string, unknown>;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [];

export interface MigrationResult {
  readonly data: Record<string, unknown>;
  readonly from: number;
  readonly applied: ReadonlyArray<number>;
}

/**
 * Runs every migration between the file's version and the current one.
 *
 * A file from the future is not this function's problem - the caller decides
 * what to do about that before getting here, because the answer ("serve it
 * read-only") is a policy, not a transformation.
 */
export function migrateToCurrent(raw: Record<string, unknown>): MigrationResult {
  const from = readVersion(raw);
  let data = raw;
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.to <= from) continue;
    if (migration.to > SETTINGS_VERSION) break;
    data = migration.migrate(data);
    applied.push(migration.to);
  }
  return { data: { ...data, version: SETTINGS_VERSION }, from, applied };
}

/** A missing or nonsensical version reads as the oldest we ever shipped. */
export function readVersion(raw: Record<string, unknown>): number {
  const value = raw["version"];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;
}
