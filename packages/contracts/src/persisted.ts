import { z } from "zod";

/**
 * A persisted map whose entries are read one at a time.
 *
 * `z.record(key, entry).catch({})` answers a single unreadable entry by
 * dropping the whole map, because one failed value fails the record. An entry
 * with a field that has no safe default (a `kind` a newer build added, an id
 * that is empty) has to be able to cost only itself.
 */
export function recordOfEach<T extends z.ZodType>(entry: T) {
  return z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((map) => {
      const kept: Record<string, z.output<T>> = {};
      for (const [key, value] of Object.entries(map)) {
        const parsed = entry.safeParse(value);
        if (parsed.success) kept[key] = parsed.data;
      }
      return kept;
    });
}
