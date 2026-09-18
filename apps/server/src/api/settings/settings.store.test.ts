import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  DEFAULT_LOG_GUTTER,
  DEFAULT_SETTINGS,
  MAX_SILENCE_ENTRIES,
  type Settings,
} from "@faws/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSettingsStore, type SettingsStore } from "./settings.store.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "faws-settings-"));
  file = path.join(dir, "settings", "settings.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function store(overrides: Partial<Parameters<typeof createSettingsStore>[0]> = {}): SettingsStore {
  return createSettingsStore({ file, ...overrides });
}

function onDisk(): Settings {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Settings;
}

describe("first run", () => {
  it("serves defaults and writes nothing", async () => {
    const snapshot = await store().load();
    expect(snapshot.settings).toEqual(DEFAULT_SETTINGS);
    expect(snapshot.pristine).toBe(true);
    expect(snapshot.persistence.writable).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("creates the file on the first change, with tight permissions", async () => {
    const first = store();
    await first.load();
    first.update({ appearance: { theme: "light" } });
    await first.flush();

    expect(onDisk().appearance.theme).toBe("light");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it("stops being pristine once anything is written", async () => {
    const first = store();
    await first.load();
    first.update({ appearance: { theme: "light" } });
    await first.flush();

    expect((await store().load()).pristine).toBe(false);
  });
});

describe("round trip", () => {
  it("reads back what a previous process wrote", async () => {
    const first = store();
    await first.load();
    first.update({ scope: { profile: "prod", region: "eu-west-1" }, logs: { gutter: 90 } });
    await first.flush();

    const reloaded = (await store().load()).settings;
    expect(reloaded.scope).toEqual({
      profile: "prod",
      region: "eu-west-1",
      connectionId: "",
      refreshSeconds: 30,
    });
    expect(reloaded.logs.gutter).toBe(90);
  });

  it("leaves untouched sections alone when patching one", async () => {
    const s = store();
    await s.load();
    s.update({ appearance: { theme: "light" } });
    const after = s.update({ logs: { gutter: 90 } }).settings;

    expect(after.appearance.theme).toBe("light");
    expect(after.scope).toEqual(DEFAULT_SETTINGS.scope);
    expect(after.terminal).toEqual(DEFAULT_SETTINGS.terminal);
    expect(after.silenced).toEqual(DEFAULT_SETTINGS.silenced);
  });

  it("falls back on a hand-edited bad value without losing its siblings", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, logs: { gutter: "wide", taskGutter: 200 } }),
    );

    const loaded = (await store().load()).settings;
    expect(loaded.logs.gutter).toBe(DEFAULT_LOG_GUTTER);
    expect(loaded.logs.taskGutter).toBe(200);
  });
});

describe("a file from a newer faws", () => {
  it("serves what it understands and refuses to write", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = JSON.stringify({
      version: 99,
      appearance: { theme: "light" },
      somethingNew: { weCannotKnow: true },
    });
    fs.writeFileSync(file, original);

    const s = store();
    const loaded = await s.load();
    expect(loaded.settings.appearance.theme).toBe("light");
    expect(loaded.persistence.writable).toBe(false);
    expect(loaded.persistence.reason).toContain("v99");

    s.update({ appearance: { theme: "dark" } });
    await s.flush();
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });
});

describe("write coalescing", () => {
  it("collapses a burst into one write holding the last value", async () => {
    const write = vi.fn(async () => undefined);
    const s = store({ write });
    await s.load();
    for (let i = 0; i < 20; i++) s.update({ logs: { gutter: 100 + i } });
    await s.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect((write.mock.calls[0] as unknown as [string, Settings])[1].logs.gutter).toBe(119);
  });
});

describe("when the file cannot be written", () => {
  it("keeps serving changes, says why, and recovers", async () => {
    let fail = true;
    const s = store({
      write: async () => {
        if (fail) throw Object.assign(new Error("read-only file system"), { code: "EROFS" });
      },
    });
    await s.load();

    s.update({ appearance: { theme: "light" } });
    await s.flush();
    expect(s.get().persistence.writable).toBe(false);
    expect(s.get().persistence.reason).toContain("EROFS");
    expect(s.get().settings.appearance.theme).toBe("light");

    fail = false;
    s.update({ logs: { gutter: 90 } });
    await s.flush();
    expect(s.get().persistence).toEqual({ writable: true, reason: null });
  });

  it("tells subscribers when writability changes", async () => {
    const s = store({
      write: async () => {
        throw Object.assign(new Error("no space"), { code: "ENOSPC" });
      },
    });
    await s.load();
    const seen: Array<boolean> = [];
    s.subscribe((snapshot) => seen.push(snapshot.persistence.writable));

    s.update({ appearance: { theme: "light" } });
    await s.flush();

    expect(seen).toEqual([true, false]);
  });
});

describe("silence operations", () => {
  it("dismisses, mutes and restores from both maps", async () => {
    const s = store();
    await s.load();
    s.applySilence({
      op: "dismiss",
      entry: { arn: "a", label: "A", context: "c", fingerprint: "f" },
    });
    s.applySilence({ op: "mute", entry: { arn: "a", label: "A", context: "c" } });
    expect(s.get().settings.silenced.dismissed["a"]).toBeDefined();
    expect(s.get().settings.silenced.muted["a"]).toBeDefined();

    const after = s.applySilence({ op: "restore", arn: "a" }).settings.silenced;
    expect(after).toEqual({ dismissed: {}, muted: {} });
  });

  it("stamps entries with the server clock, not the client's", async () => {
    const s = store({ now: () => new Date("2026-03-04T05:06:07.000Z") });
    await s.load();
    const entry = s.applySilence({ op: "mute", entry: { arn: "a", label: "A", context: "" } })
      .settings.silenced.muted["a"];
    expect(entry?.at).toBe("2026-03-04T05:06:07.000Z");
  });

  it("evicts the oldest once the map fills", async () => {
    let tick = 0;
    const s = store({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) });
    await s.load();
    for (let i = 0; i < MAX_SILENCE_ENTRIES + 10; i++) {
      s.applySilence({ op: "mute", entry: { arn: `arn-${i}`, label: "", context: "" } });
    }
    const muted = s.get().settings.silenced.muted;
    expect(Object.keys(muted)).toHaveLength(MAX_SILENCE_ENTRIES);
    expect(muted["arn-0"]).toBeUndefined();
    expect(muted[`arn-${MAX_SILENCE_ENTRIES + 9}`]).toBeDefined();
  });

  it("clears everything on restoreAll", async () => {
    const s = store();
    await s.load();
    s.applySilence({ op: "mute", entry: { arn: "a", label: "", context: "" } });
    expect(s.applySilence({ op: "restoreAll" }).settings.silenced).toEqual({
      dismissed: {},
      muted: {},
    });
  });
});

describe("legacy import", () => {
  it("adopts localStorage values while the store is pristine", async () => {
    const s = store();
    await s.load();
    const result = s.importLegacy(
      { appearance: { theme: "light" } },
      { muted: { a: { arn: "a", label: "A", context: "", at: "2026-01-01T00:00:00.000Z" } } },
    );

    expect(result.imported).toBe(true);
    expect(result.snapshot.settings.appearance.theme).toBe("light");
    expect(result.snapshot.settings.silenced.muted["a"]).toBeDefined();
  });

  it("is a no-op once anything has been written", async () => {
    const s = store();
    await s.load();
    s.update({ appearance: { theme: "dark" } });

    const result = s.importLegacy({ appearance: { theme: "light" } }, {});
    expect(result.imported).toBe(false);
    expect(result.snapshot.settings.appearance.theme).toBe("dark");
  });
});

describe("subscribers", () => {
  it("fire once per change, carrying the origin", async () => {
    const s = store();
    await s.load();
    const listener = vi.fn();
    const unsubscribe = s.subscribe(listener);

    s.update({ appearance: { theme: "light" } }, "tab-1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[1]).toBe("tab-1");
    expect(listener.mock.calls[0]?.[0].revision).toBe(1);

    unsubscribe();
    s.update({ logs: { gutter: 90 } }, "tab-1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("advances the revision on every change", async () => {
    const s = store();
    await s.load();
    expect(s.get().revision).toBe(0);
    expect(s.update({ logs: { gutter: 90 } }).revision).toBe(1);
    expect(s.applySilence({ op: "restoreAll" }).revision).toBe(2);
  });
});

describe("reset", () => {
  it("puts every section back to its default", async () => {
    const s = store();
    await s.load();
    s.update({ appearance: { theme: "light" }, scope: { profile: "prod" } });
    s.applySilence({ op: "mute", entry: { arn: "a", label: "", context: "" } });

    expect(s.reset().settings).toEqual(DEFAULT_SETTINGS);
  });
});
