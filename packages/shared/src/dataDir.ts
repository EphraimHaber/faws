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

/**
 * Where credentials for storage outside AWS are kept.
 *
 * Its own directory rather than a file beside the settings: what is in here is
 * the key itself, not a preference, and the two have different rules. Settings
 * are read on first paint, broadcast to every window and quoted in bug
 * reports; nothing in this directory is ever any of those things.
 *
 * AWS's own credentials are not here - they stay in `~/.aws`, resolved by the
 * SDK's provider chain, because duplicating them would mean two places to
 * rotate.
 */
export function credentialsDir(): string {
  return path.join(resolveDataDir(), "credentials");
}

/** Keys for saved S3 endpoints, one entry per credential reference. */
export function s3CredentialsFile(): string {
  return path.join(credentialsDir(), "s3.json");
}
