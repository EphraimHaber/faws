import * as os from "node:os";
import * as path from "node:path";

/**
 * Where faws parks logs and cached UI state.
 *
 * The desktop shell passes the Electron userData path through
 * `FAWS_DATA_DIR`; standalone server/dev runs fall back to a stable
 * dot-directory in $HOME so state survives a `node_modules` wipe.
 */
export function resolveDataDir(): string {
  const fromEnv = process.env["FAWS_DATA_DIR"]?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".faws");
}

export function logsDir(): string {
  return path.join(resolveDataDir(), "logs");
}

/**
 * Where session recordings land.
 *
 * Separate from `logs` because these are transcripts of someone's shell, not
 * diagnostics: they are written with tighter permissions, swept on their own
 * schedule, and are the thing a person would hand to an auditor.
 */
export function recordingsDir(): string {
  return path.join(resolveDataDir(), "recordings");
}

/**
 * Where persisted user preferences live.
 *
 * A directory rather than a bare `settings.json` at the data-dir root: the
 * loader quarantines an unreadable file beside the good one, so there has to
 * be somewhere for those copies to go, and one directory carries the 0700
 * that keeps profile names and ARNs out of other accounts' reach.
 */
export function settingsDir(): string {
  return path.join(resolveDataDir(), "settings");
}

export function settingsFile(): string {
  return path.join(settingsDir(), "settings.json");
}
