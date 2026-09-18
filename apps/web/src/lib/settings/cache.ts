/**
 * A copy of the last-known settings, kept only so the first frame is right.
 *
 * **This is a hint, never a source of truth.** It is read once, before the
 * fetch resolves, and never again; the server's answer replaces it whatever it
 * says. The whole point of moving settings to the server was to stop the
 * browser owning them, and this is the one surviving `localStorage` key - so
 * if you are reaching for it anywhere other than initial state, you want the
 * store instead.
 *
 * It exists because theme and scope were read synchronously before, and a
 * round trip in their place is a flash of the wrong colour scheme followed by
 * a re-render. In packaged builds the server injects `window.fawsSettings`
 * and this is never consulted; it is what covers the dev server and a plain
 * browser tab on their second load onward.
 */
import { DEFAULT_SETTINGS, type Settings, settingsSchema } from "@faws/contracts";

const CACHE_KEY = "faws:settings-cache";

declare global {
  interface Window {
    /** Written into the served HTML by the server. Absent under Vite. */
    fawsSettings?: unknown;
  }
}

/**
 * The best guess available before the network answers.
 *
 * Everything goes through `settingsSchema`, which catches per leaf, so a cache
 * written by an older build degrades field by field instead of being thrown
 * away whole.
 */
export function seedSettings(): Settings {
  const injected = readInjected();
  if (injected) return injected;
  return readCache() ?? DEFAULT_SETTINGS;
}

function readInjected(): Settings | null {
  try {
    if (window.fawsSettings === undefined) return null;
    return settingsSchema.parse(window.fawsSettings);
  } catch {
    return null;
  }
}

function readCache(): Settings | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    return settingsSchema.parse(JSON.parse(raw));
  } catch {
    // Blocked storage, or a cache this build cannot read at all.
    return null;
  }
}

export function writeCache(settings: Settings): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / blocked storage - the session still works */
  }
}
