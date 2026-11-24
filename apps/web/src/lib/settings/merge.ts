/**
 * Combining patches that pile up while one is in flight.
 *
 * A gutter drag produces a patch per `pointermove`. Sending them as a queue
 * would put sixty round trips on the wire to describe one final width, so the
 * store holds a pending patch and merges each new one into it. Merging rather
 * than replacing matters when a drag and an unrelated toggle overlap: the
 * toggle must not be dropped just because the drag wrote last.
 */
import { type SettingsPatch, settingsPatchSchema } from "@faws/contracts";

type Section = keyof SettingsPatch;

/**
 * Read from the schema rather than listed here: a section missing from a hand
 * written list is merged away and never sent, while every screen still shows it.
 */
const SECTIONS = Object.keys(settingsPatchSchema.shape) as ReadonlyArray<Section>;

export function mergePatches(base: SettingsPatch, next: SettingsPatch): SettingsPatch {
  return deepMerge(base, next) as SettingsPatch;
}

/**
 * Merged all the way down, because provider sections nest: a patch switching
 * AWS off and a pending one changing its region are both `providers.aws`, and
 * a one-level merge would let the later drop the earlier.
 */
function deepMerge(base: object, next: object): object {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, incoming] of Object.entries(next)) {
    if (incoming === undefined) continue;
    const current = merged[key];
    merged[key] =
      isPlainObject(current) && isPlainObject(incoming) ? deepMerge(current, incoming) : incoming;
  }
  return merged;
}

function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a patch would change anything, so an empty flush can be skipped. */
export function isEmptyPatch(patch: SettingsPatch): boolean {
  return SECTIONS.every((key) => {
    const section = patch[key];
    return !section || Object.keys(section).length === 0;
  });
}
