/**
 * Combining patches that pile up while one is in flight.
 *
 * A gutter drag produces a patch per `pointermove`. Sending them as a queue
 * would put sixty round trips on the wire to describe one final width, so the
 * store holds a pending patch and merges each new one into it. Merging rather
 * than replacing matters when a drag and an unrelated toggle overlap: the
 * toggle must not be dropped just because the drag wrote last.
 */
import type { SettingsPatch } from "@faws/contracts";

type Section = keyof SettingsPatch;

const SECTIONS: ReadonlyArray<Section> = ["scope", "logs", "appearance", "terminal"];

export function mergePatches(base: SettingsPatch, next: SettingsPatch): SettingsPatch {
  const merged: Record<string, unknown> = { ...base };
  for (const key of SECTIONS) {
    const incoming = next[key];
    if (!incoming) continue;
    merged[key] = { ...base[key], ...incoming };
  }
  return merged as SettingsPatch;
}

/** Whether a patch would change anything, so an empty flush can be skipped. */
export function isEmptyPatch(patch: SettingsPatch): boolean {
  return SECTIONS.every((key) => {
    const section = patch[key];
    return !section || Object.keys(section).length === 0;
  });
}
