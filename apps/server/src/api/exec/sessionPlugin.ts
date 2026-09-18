/**
 * Finds AWS's `session-manager-plugin` binary.
 *
 * Worth more than the two lines it looks like, because the failure mode is
 * specific and common: a GUI-launched macOS app inherits launchd's minimal
 * PATH, not the shell's, so a plugin the user installed with Homebrew and uses
 * daily in their terminal is invisible to us. Shelling out to `which` inherits
 * exactly the same broken PATH and does not exist on Windows at all, so the
 * search is done here, in Node, and ends with the paths the official installers
 * actually use.
 *
 * The result is memoized: the answer cannot change while the process runs, and
 * a filesystem probe per session start is wasted work.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type PluginSource = "env" | "bundled" | "path" | "well-known" | "missing";

export interface PluginResolution {
  readonly path: string | null;
  readonly source: PluginSource;
  /** Present when the plugin could not be found, or an override was unusable. */
  readonly problem: string | null;
}

const EXE = process.platform === "win32" ? "session-manager-plugin.exe" : "session-manager-plugin";

/** Where the official installers put it, per platform. */
function wellKnownPaths(): string[] {
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    return [path.join(programFiles, "Amazon", "SessionManagerPlugin", "bin", EXE)];
  }
  return [
    // The macOS and Linux bundle installers both land here.
    "/usr/local/sessionmanagerplugin/bin/session-manager-plugin",
    "/opt/homebrew/bin/session-manager-plugin",
    "/usr/local/bin/session-manager-plugin",
    "/usr/bin/session-manager-plugin",
  ];
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
function searchPath(): string | null {
  const entries = (process.env["PATH"] ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".EXE").split(";").filter(Boolean)
      : [""];

  for (const dir of entries) {
    for (const ext of extensions) {
      const candidate = path.join(
        dir,
        process.platform === "win32" ? `session-manager-plugin${ext}` : EXE,
      );
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

let cached: PluginResolution | null = null;

export function resolveSessionPlugin(): PluginResolution {
  if (cached) return cached;
  cached = resolve();
  return cached;
}

/** For tests and for a settings screen that re-checks after an install. */
export function forgetSessionPlugin(): void {
  cached = null;
}

function resolve(): PluginResolution {
  const override = process.env["FAWS_SESSION_MANAGER_PLUGIN"]?.trim();
  if (override) {
    // An override that is set but wrong is a hard error rather than a
    // fallthrough: silently searching elsewhere makes a typo look like the
    // override never applied, which is a genuinely baffling half hour.
    if (isExecutable(override)) return { path: override, source: "env", problem: null };
    return {
      path: null,
      source: "missing",
      problem: `FAWS_SESSION_MANAGER_PLUGIN is set to ${override}, which is not an executable file.`,
    };
  }

  const resourcesPath = process.env["FAWS_RESOURCES_PATH"];
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, "bin", EXE);
    if (isExecutable(bundled)) return { path: bundled, source: "bundled", problem: null };
  }

  const onPath = searchPath();
  if (onPath) return { path: onPath, source: "path", problem: null };

  for (const candidate of wellKnownPaths()) {
    if (isExecutable(candidate)) return { path: candidate, source: "well-known", problem: null };
  }

  return { path: null, source: "missing", problem: installHint() };
}

/** The message a user can act on without leaving the app to search. */
function installHint(): string {
  switch (process.platform) {
    case "darwin":
      return "The Session Manager plugin is not installed. Install it with `brew install --cask session-manager-plugin`, or from AWS's macOS bundle, then reopen this panel.";
    case "win32":
      return "The Session Manager plugin is not installed. Install it from AWS's Windows installer, then reopen this panel.";
    default:
      return "The Session Manager plugin is not installed. Install AWS's .deb or .rpm package for your distribution, then reopen this panel.";
  }
}
