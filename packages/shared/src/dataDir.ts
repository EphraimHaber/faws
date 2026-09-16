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
