/**
 * Finds an external binary this app spawns: `session-manager-plugin`,
 * `kubectl`, `oc`, `virtctl`.
 *
 * Worth more than the two lines it looks like, because the failure mode is
 * specific and common: a GUI-launched macOS app inherits launchd's minimal
 * PATH, not the shell's, so a binary the user installed with Homebrew and uses
 * daily in their terminal is invisible to us. Shelling out to `which` inherits
 * exactly the same broken PATH and does not exist on Windows at all, so the
 * search is done here, in Node, and ends with the paths the official installers
 * actually use.
 *
 * The result is memoized per name: the answer cannot change while the process
 * runs, and a filesystem probe per session start - or per keystroke in a
 * pre-flight check - is wasted work.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type BinarySource = "env" | "bundled" | "path" | "well-known" | "missing";

export interface BinaryResolution {
  readonly name: string;
  readonly path: string | null;
  readonly source: BinarySource;
  /** Present when the binary could not be found, or an override was unusable. */
  readonly problem: string | null;
}

export interface ResolveBinaryOptions {
  /** An env var naming an explicit path, which wins over every other source. */
  readonly envVar?: string;
  /** Look beside the packaged app, under `FAWS_RESOURCES_PATH/bin`. */
  readonly bundled?: boolean;
  /** Where the official installers put it, tried after the PATH scan. */
  readonly extraPaths?: readonly string[];
  /** What to tell someone who does not have it, in one actionable sentence. */
  readonly installHint?: string;
}

/** The on-disk file name, which carries an extension on Windows. */
function fileName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** A PATH scan that honours PATHEXT, which `which` would not do on Windows. */
function searchPath(name: string): string | null {
  const entries = (process.env["PATH"] ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".EXE").split(";").filter(Boolean)
      : [""];

  for (const dir of entries) {
    for (const ext of extensions) {
      const candidate = path.join(
        dir,
        process.platform === "win32" ? `${name}${ext}` : fileName(name),
      );
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

const cached = new Map<string, BinaryResolution>();

export function resolveBinary(name: string, options: ResolveBinaryOptions = {}): BinaryResolution {
  const hit = cached.get(name);
  if (hit) return hit;
  const resolution = resolve(name, options);
  cached.set(name, resolution);
  return resolution;
}

/** For tests and for a settings screen that re-checks after an install. */
export function forgetBinary(name?: string): void {
  if (name === undefined) cached.clear();
  else cached.delete(name);
}

function resolve(name: string, options: ResolveBinaryOptions): BinaryResolution {
  const override = options.envVar ? process.env[options.envVar]?.trim() : undefined;
  if (override) {
    // An override that is set but wrong is a hard error rather than a
    // fallthrough: silently searching elsewhere makes a typo look like the
    // override never applied, which is a genuinely baffling half hour.
    if (isExecutable(override)) return { name, path: override, source: "env", problem: null };
    return {
      name,
      path: null,
      source: "missing",
      problem: `${options.envVar} is set to ${override}, which is not an executable file.`,
    };
  }

  const resourcesPath = options.bundled ? process.env["FAWS_RESOURCES_PATH"] : undefined;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, "bin", fileName(name));
    if (isExecutable(bundled)) return { name, path: bundled, source: "bundled", problem: null };
  }

  const onPath = searchPath(name);
  if (onPath) return { name, path: onPath, source: "path", problem: null };

  for (const candidate of options.extraPaths ?? []) {
    if (isExecutable(candidate)) {
      return { name, path: candidate, source: "well-known", problem: null };
    }
  }

  return {
    name,
    path: null,
    source: "missing",
    problem: options.installHint ?? `${name} was not found on this machine.`,
  };
}
