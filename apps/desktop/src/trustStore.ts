/**
 * Keeps the main process's Chromium sessions trusting what the app trusts.
 *
 * The server owns `settings.json` and writes it atomically (temp file, then
 * rename), so the directory is watched rather than the file, and every change
 * re-reads it after a short debounce. A missing file trusts nothing extra; a
 * file that will not parse keeps the last entries read, since the server
 * quarantines it and writes a fresh one moments later.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { TrustEntry } from "@faws/contracts";
import type { Session } from "electron";

import { chainOf, decide, trustEntriesOf } from "./trust.ts";

const SETTINGS_FILE = "settings.json";
const DEBOUNCE_MS = 200;

let entries: ReadonlyArray<TrustEntry> = [];

function reload(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    entries = [];
    return;
  }
  try {
    entries = trustEntriesOf(JSON.parse(text));
  } catch {
    // Unparseable: keep what was last read until the server rewrites it.
  }
}

/**
 * Reads `<dataDir>/settings/settings.json`, keeps it current, and installs a
 * verify proc on each session that defers to Chromium except where `decide`
 * says the app's trust store vouches for the chain.
 */
export function followAppTrust(dataDir: string, sessions: ReadonlyArray<Session>): void {
  const dir = path.join(dataDir, "settings");
  const file = path.join(dir, SETTINGS_FILE);
  reload(file);

  try {
    // Same mode the server creates it with; watching needs it to exist.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    let timer: NodeJS.Timeout | undefined;
    const watcher = fs.watch(dir, (_event, name) => {
      if (name !== null && name !== SETTINGS_FILE) return;
      clearTimeout(timer);
      timer = setTimeout(() => reload(file), DEBOUNCE_MS);
    });
    watcher.on("error", (err) => {
      process.stderr.write(`[faws] trust store watch stopped: ${String(err)}\n`);
    });
    watcher.unref();
  } catch (err) {
    process.stderr.write(`[faws] cannot watch ${dir}: ${String(err)}\n`);
  }

  for (const session of sessions) {
    session.setCertificateVerifyProc((request, callback) => {
      const verdict = decide(
        {
          hostname: request.hostname,
          errorCode: request.errorCode,
          chain: chainOf(request.certificate),
        },
        entries,
      );
      callback(verdict.result);
    });
  }
}
