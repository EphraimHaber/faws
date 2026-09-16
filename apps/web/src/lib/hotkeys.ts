/**
 * Hotkey vocabulary for the app.
 *
 * Every binding registers with `meta`, so the `?` overlay is generated from
 * the live registry rather than from a table someone has to remember to
 * update. Changing a key changes the documentation.
 */
import type { HotkeyMeta } from "@tanstack/react-hotkeys";

export const HOTKEY_CATEGORIES = ["Navigation", "Table", "Context"] as const;

export type HotkeyCategory = (typeof HOTKEY_CATEGORIES)[number];

declare module "@tanstack/hotkeys" {
  interface HotkeyMeta {
    /** Groups the binding in the help overlay. */
    category?: HotkeyCategory;
  }
}

/** Shorthand for the `meta` blocks every registration carries. */
export function describe(category: HotkeyCategory, name: string, description?: string): HotkeyMeta {
  return { category, name, ...(description ? { description } : {}) };
}
