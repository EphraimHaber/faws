/**
 * Reading and writing localStorage preferences.
 *
 * Two hazards, both of which every caller would otherwise have to remember:
 * storage outlives the code that wrote it and the user can edit it by hand, so
 * a stored value is untrusted input; and the accessors themselves throw in
 * private mode or with site data blocked, which would take down the render
 * that happened to read a preference.
 *
 * Both are answered by requiring a schema that `catch`es. `readStored` parses
 * `null` on any failure, so the schema's own fallback is the single definition
 * of the default - there is no second copy of it at the call site to drift.
 */
import type { z } from "zod";

export function readStored<T>(key: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(window.localStorage.getItem(key));
  } catch {
    // Blocked storage: the schema's own fallback is still the right answer.
    return schema.parse(null);
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / blocked storage - the session still works */
  }
}
