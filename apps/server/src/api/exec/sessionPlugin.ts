/**
 * Finds AWS's `session-manager-plugin` binary.
 *
 * The search itself is `shared/binaries.ts`, because the same PATH problem
 * applies verbatim to `kubectl`, `oc` and `virtctl`. What stays here is the
 * part that is only true of this binary: the env var that overrides it, where
 * the official installers put it, and what to tell someone who does not have
 * it.
 */
import * as path from "node:path";

import { type BinarySource, forgetBinary, resolveBinary } from "../../shared/binaries.ts";

export type PluginSource = BinarySource;

export interface PluginResolution {
  readonly path: string | null;
  readonly source: PluginSource;
  /** Present when the plugin could not be found, or an override was unusable. */
  readonly problem: string | null;
}

const NAME = "session-manager-plugin";

/** Where the official installers put it, per platform. */
function wellKnownPaths(): string[] {
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    return [path.join(programFiles, "Amazon", "SessionManagerPlugin", "bin", `${NAME}.exe`)];
  }
  return [
    // The macOS and Linux bundle installers both land here.
    "/usr/local/sessionmanagerplugin/bin/session-manager-plugin",
    "/opt/homebrew/bin/session-manager-plugin",
    "/usr/local/bin/session-manager-plugin",
    "/usr/bin/session-manager-plugin",
  ];
}

export function resolveSessionPlugin(): PluginResolution {
  const {
    path: found,
    source,
    problem,
  } = resolveBinary(NAME, {
    envVar: "FAWS_SESSION_MANAGER_PLUGIN",
    bundled: true,
    extraPaths: wellKnownPaths(),
    installHint: installHint(),
  });
  return { path: found, source, problem };
}

/** For tests and for a settings screen that re-checks after an install. */
export function forgetSessionPlugin(): void {
  forgetBinary(NAME);
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
