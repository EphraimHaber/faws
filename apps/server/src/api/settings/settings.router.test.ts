/**
 * The wiring test.
 *
 * The store has its own tests; what this one catches is the pair of mistakes
 * unit tests cannot see - forgetting to register the namespace on `appRouter`,
 * and forgetting to `load()` the store before anything asks it for a value.
 * It runs against a temp `FAWS_DATA_DIR`, set before the module graph is
 * imported because `settingsFile()` is resolved at first use.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Settings } from "@faws/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faws-settings-router-"));
process.env["FAWS_DATA_DIR"] = dir;

const { appRouter } = await import("../../router.ts");
const { settingsStore } = await import("./settings.instance.ts");

const file = path.join(dir, "settings", "settings.json");
const caller = appRouter.createCaller({});

beforeAll(async () => {
  await settingsStore().load();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the settings namespace", () => {
  it("serves, updates and persists through the router", async () => {
    expect((await caller.settings.get()).pristine).toBe(true);

    const seen: Array<string | null> = [];
    const unsubscribe = settingsStore().subscribe((_, originId) => seen.push(originId));

    const updated = await caller.settings.update({
      patch: { appearance: { theme: "light" }, scope: { profile: "prod" } },
      originId: "tab-1",
    });
    expect(updated.settings.appearance.theme).toBe("light");
    expect(seen).toEqual(["tab-1"]);
    unsubscribe();

    expect((await caller.settings.get()).settings.scope.profile).toBe("prod");

    await settingsStore().flush();
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Settings;
    expect(onDisk.appearance.theme).toBe("light");
    expect(onDisk.version).toBe(1);
  });

  it("applies a silence op and then restores it", async () => {
    await caller.settings.silence({
      op: { op: "mute", entry: { arn: "arn:aws:ecs:svc", label: "svc", context: "prod" } },
    });
    expect((await caller.settings.get()).settings.silenced.muted["arn:aws:ecs:svc"]).toBeDefined();

    const restored = await caller.settings.silence({
      op: { op: "restore", arn: "arn:aws:ecs:svc" },
    });
    expect(restored.settings.silenced.muted).toEqual({});
  });

  it("stores a table layout and resets it", async () => {
    const set = await caller.settings.tables({
      op: {
        op: "set",
        table: "ec2-instances",
        layout: { order: ["state"], hidden: ["type"], shown: [] },
      },
    });
    expect(set.settings.tables.layouts["ec2-instances"]).toEqual({
      order: ["state"],
      hidden: ["type"],
      shown: [],
    });

    const reset = await caller.settings.tables({ op: { op: "reset", table: "ec2-instances" } });
    expect(reset.settings.tables.layouts).toEqual({});
  });

  it("refuses a patch that tries to reach the silence maps", async () => {
    await expect(
      // @ts-expect-error - the point of the test is that the schema rejects it.
      caller.settings.update({ patch: { silenced: { muted: {} } } }),
    ).rejects.toThrow();
  });
});
