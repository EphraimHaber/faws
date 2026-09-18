import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { probeWritable, readSettingsFile, writeSettingsFileAtomic } from "./settings.file.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "faws-settings-file-"));
  file = path.join(dir, "settings", "settings.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function corruptCopies(): string[] {
  return fs
    .readdirSync(path.dirname(file))
    .filter((name) => name.startsWith("settings.json.corrupt-"));
}

function tempLeftovers(): string[] {
  return fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp-"));
}

describe("readSettingsFile", () => {
  it("reports a missing file rather than throwing", async () => {
    expect(await readSettingsFile(file)).toEqual({ raw: null, missing: true, corruptedTo: null });
  });

  it("moves an unparseable file aside and keeps its bytes", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");

    const result = await readSettingsFile(file);
    expect(result.raw).toBeNull();
    expect(result.missing).toBe(false);
    expect(result.corruptedTo).not.toBeNull();
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(result.corruptedTo as string, "utf8")).toBe("{ not json");
  });

  it("treats valid JSON that is not an object as corrupt", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "[1, 2, 3]");
    expect((await readSettingsFile(file)).corruptedTo).not.toBeNull();
  });

  it("keeps only the three newest quarantined copies", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(file, `broken ${i}`);
      await readSettingsFile(file);
      // The quarantine name is stamped to the millisecond; without a gap two
      // in the same tick would collide and the count would lie.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(corruptCopies()).toHaveLength(3);
  });
});

describe("writeSettingsFileAtomic", () => {
  it("creates the tree and leaves no temp file behind", async () => {
    await writeSettingsFileAtomic(file, { version: 1 });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1 });
    expect(tempLeftovers()).toEqual([]);
  });

  it("cleans up the temp file when the write fails", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    await expect(writeSettingsFileAtomic(file, circular)).rejects.toThrow();
    expect(tempLeftovers()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("replaces an existing file rather than appending to it", async () => {
    await writeSettingsFileAtomic(file, { version: 1, a: 1 });
    await writeSettingsFileAtomic(file, { version: 1, b: 2 });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1, b: 2 });
  });
});

describe("probeWritable", () => {
  it("says nothing is wrong with a writable directory", async () => {
    expect(await probeWritable(file)).toBeNull();
  });

  it("reports the errno when the directory cannot be created", async () => {
    // A file where the directory should be: mkdir fails with EEXIST/ENOTDIR.
    fs.writeFileSync(path.join(dir, "settings"), "in the way");
    const reason = await probeWritable(file);
    expect(reason).toMatch(/E[A-Z]+:/);
  });
});
