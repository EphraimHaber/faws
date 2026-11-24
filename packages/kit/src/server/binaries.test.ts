import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetBinary, machOArchitectures, resolveBinary, runsOn } from "./binaries.ts";

let dir: string;
const platform = process.platform;
const env = { ...process.env };

/** A file the X_OK probe will accept, which a 0644 file would not. */
function writeExecutable(name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });
  return file;
}

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "faws-binaries-"));
  forgetBinary();
  // An inherited PATH would let a real `kubectl` answer these, so the scan is
  // pointed at the temp directory and nowhere else.
  process.env["PATH"] = dir;
  delete process.env["PATHEXT"];
  delete process.env["FAWS_RESOURCES_PATH"];
});

afterEach(() => {
  setPlatform(platform);
  process.env = { ...env };
  forgetBinary();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the env override", () => {
  it("wins over everything else when it points at an executable", () => {
    writeExecutable("kubectl");
    const override = writeExecutable("kubectl-from-env");
    process.env["FAWS_KUBECTL"] = override;

    expect(resolveBinary("kubectl", { envVar: "FAWS_KUBECTL" })).toEqual({
      name: "kubectl",
      path: override,
      source: "env",
      problem: null,
    });
  });

  it("is a hard error when it is set but not executable", () => {
    // The binary is on PATH, so a fallthrough would succeed and make the typo
    // look like the override was never read at all.
    writeExecutable("kubectl");
    process.env["FAWS_KUBECTL"] = path.join(dir, "nowhere");

    const resolution = resolveBinary("kubectl", { envVar: "FAWS_KUBECTL" });

    expect(resolution.path).toBeNull();
    expect(resolution.source).toBe("missing");
    expect(resolution.problem).toContain("FAWS_KUBECTL");
  });
});

describe("the PATH scan", () => {
  it("finds a binary on PATH", () => {
    const found = writeExecutable("kubectl");
    expect(resolveBinary("kubectl")).toMatchObject({ path: found, source: "path" });
  });

  it("tries each PATHEXT extension on win32", () => {
    setPlatform("win32");
    const found = writeExecutable("kubectl.CMD");
    process.env["PATHEXT"] = ".COM;.CMD";

    expect(resolveBinary("kubectl")).toMatchObject({ path: found, source: "path" });
  });
});

describe("the fallbacks", () => {
  it("falls back to a well-known path when PATH has nothing", () => {
    const installed = writeExecutable("virtctl-installed");

    expect(resolveBinary("virtctl", { extraPaths: [installed] })).toMatchObject({
      path: installed,
      source: "well-known",
    });
  });

  it("reports the install hint when nothing is found", () => {
    expect(resolveBinary("oc", { installHint: "Install the OpenShift CLI." })).toEqual({
      name: "oc",
      path: null,
      source: "missing",
      problem: "Install the OpenShift CLI.",
    });
  });
});

describe("memoization", () => {
  it("is per name, so one binary's answer is not another's", () => {
    const kubectl = writeExecutable("kubectl");

    expect(resolveBinary("kubectl").path).toBe(kubectl);
    expect(resolveBinary("virtctl").path).toBeNull();

    // Installing it later does not change an answer already handed out, which
    // is what `forgetBinary` exists for.
    const virtctl = writeExecutable("virtctl");
    expect(resolveBinary("virtctl").path).toBeNull();
    forgetBinary("virtctl");
    expect(resolveBinary("virtctl").path).toBe(virtctl);
  });
});

/** The first bytes of a thin 64-bit Mach-O binary for one CPU type. */
function thinMachO(cpuType: number): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cpuType, 4);
  return header;
}

/** The first bytes of a universal binary carrying these CPU types. */
function fatMachO(cpuTypes: number[]): Buffer {
  const header = Buffer.alloc(8 + cpuTypes.length * 20);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(cpuTypes.length, 4);
  cpuTypes.forEach((cpu, index) => header.writeUInt32BE(cpu, 8 + index * 20));
  return header;
}

const X86_64 = 0x01000007;
const ARM64 = 0x0100000c;

describe("machOArchitectures", () => {
  it("reads the CPU a thin binary was built for", () => {
    expect(machOArchitectures(thinMachO(X86_64))).toEqual(["x64"]);
    expect(machOArchitectures(thinMachO(ARM64))).toEqual(["arm64"]);
  });

  it("reads every CPU in a universal binary", () => {
    expect(machOArchitectures(fatMachO([X86_64, ARM64]))).toEqual(["x64", "arm64"]);
  });

  it("answers null for anything that is not Mach-O, such as a script", () => {
    expect(machOArchitectures(Buffer.from("#!/bin/sh\n"))).toBeNull();
    expect(machOArchitectures(Buffer.alloc(2))).toBeNull();
  });
});

describe("runsOn", () => {
  it("runs a binary built for this CPU", () => {
    expect(runsOn(["arm64"], { arch: "arm64", rosetta: false })).toBe(true);
    expect(runsOn(["x64", "arm64"], { arch: "arm64", rosetta: false })).toBe(true);
  });

  it("runs an Intel binary on Apple silicon only through Rosetta", () => {
    expect(runsOn(["x64"], { arch: "arm64", rosetta: false })).toBe(false);
    expect(runsOn(["x64"], { arch: "arm64", rosetta: true })).toBe(true);
  });

  it("does not run an Apple silicon binary on an Intel Mac", () => {
    expect(runsOn(["arm64"], { arch: "x64", rosetta: true })).toBe(false);
  });

  it("assumes a file it cannot read the architecture of will run", () => {
    expect(runsOn(null, { arch: "arm64", rosetta: false })).toBe(true);
  });
});
