import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetBinary, resolveBinary } from "./binaries.ts";

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
