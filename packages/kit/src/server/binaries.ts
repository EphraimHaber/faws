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

export type BinarySource = "env" | "bundled" | "path" | "well-known" | "missing" | "unrunnable";

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

/** Mach-O CPU types, as the kernel writes them, named the way `process.arch` does. */
const CPU_TYPES: Record<number, string> = {
  0x01000007: "x64",
  0x0100000c: "arm64",
};

/**
 * Which CPUs a macOS binary was built for, read from its first bytes, or null
 * when the file is not a Mach-O binary at all - a shell script, say.
 */
export function machOArchitectures(header: Buffer): string[] | null {
  if (header.length < 8) return null;
  // Thin 64-bit binaries are little-endian on every Mac that exists.
  if (header.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = CPU_TYPES[header.readUInt32LE(4)];
    return cpu ? [cpu] : [];
  }
  // A universal binary's header is big-endian, then one 20-byte entry per CPU.
  if (header.readUInt32BE(0) === 0xcafebabe) {
    const count = header.readUInt32BE(4);
    const found: string[] = [];
    for (let index = 0; index < count && 8 + index * 20 + 4 <= header.length; index++) {
      const cpu = CPU_TYPES[header.readUInt32BE(8 + index * 20)];
      if (cpu) found.push(cpu);
    }
    return found;
  }
  return null;
}

/**
 * Whether a binary built for these CPUs will start on this machine.
 *
 * An Intel build on Apple silicon needs Rosetta. Without it, macOS refuses to
 * exec the file at all, and a child spawned through a PTY simply exits with
 * code 1 and prints nothing - which is why this is checked before spawning
 * rather than diagnosed afterwards.
 */
export function runsOn(
  architectures: readonly string[] | null,
  host: { arch: string; rosetta: boolean },
): boolean {
  if (architectures === null) return true;
  if (architectures.includes(host.arch)) return true;
  return host.arch === "arm64" && host.rosetta && architectures.includes("x64");
}

/** Where Rosetta 2 lives once installed; its absence means Intel builds will not start. */
const ROSETTA = "/Library/Apple/usr/share/rosetta/rosetta";

/** Why a found binary cannot start here, or null when it can. */
function unrunnableReason(file: string, name: string): string | null {
  if (process.platform !== "darwin") return null;
  let header: Buffer;
  try {
    const fd = fs.openSync(file, "r");
    try {
      header = Buffer.alloc(4096);
      const read = fs.readSync(fd, header, 0, header.length, 0);
      header = header.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const architectures = machOArchitectures(header);
  if (runsOn(architectures, { arch: process.arch, rosetta: fs.existsSync(ROSETTA) })) return null;
  const built = architectures?.includes("x64") ? "Intel Macs (x86_64)" : "a different CPU";
  return process.arch === "arm64"
    ? `${file} is built for ${built}, and this Mac is Apple silicon without Rosetta. Install the Apple silicon build of ${name}, or install Rosetta with \`softwareupdate --install-rosetta\`.`
    : `${file} is built for ${built} and cannot run on this Mac. Install the build of ${name} for this machine.`;
}

/** A found binary, unless it cannot start on this machine. */
function found(name: string, file: string, source: BinarySource): BinaryResolution {
  const problem = unrunnableReason(file, name);
  return problem
    ? { name, path: null, source: "unrunnable", problem }
    : { name, path: file, source, problem: null };
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
    if (isExecutable(override)) return found(name, override, "env");
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
    if (isExecutable(bundled)) return found(name, bundled, "bundled");
  }

  const onPath = searchPath(name);
  if (onPath) return found(name, onPath, "path");

  for (const candidate of options.extraPaths ?? []) {
    if (isExecutable(candidate)) return found(name, candidate, "well-known");
  }

  return {
    name,
    path: null,
    source: "missing",
    problem: options.installHint ?? `${name} was not found on this machine.`,
  };
}
