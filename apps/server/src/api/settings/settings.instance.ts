/**
 * The process-wide settings store.
 *
 * A singleton because there is exactly one settings file per server and the
 * router, the socket bridge and the shutdown path all need the same one. The
 * factory in `settings.store.ts` stays exported so tests can build their own
 * against a temp directory and never touch `~/.faws`.
 */
import { settingsFile } from "@faws/shared/dataDir";

import { createSettingsStore, type SettingsStore } from "./settings.store.ts";

let instance: SettingsStore | null = null;

export function settingsStore(): SettingsStore {
  instance ??= createSettingsStore({ file: settingsFile() });
  return instance;
}

/** Called once from `main.ts` before the server listens. */
export async function loadSettings(): Promise<void> {
  await settingsStore().load();
}

/** Called from the shutdown path so a preference set a moment ago survives. */
export async function flushSettings(): Promise<void> {
  if (instance) await instance.flush();
}
