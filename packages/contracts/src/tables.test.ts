import { describe, expect, it } from "vitest";

import { settingsPatchSchema, settingsSchema } from "./settings.ts";
import {
  applyTableLayoutOp,
  MAX_TABLE_LAYOUTS,
  type TableLayoutOp,
  tablesSettingsSchema,
} from "./tables.ts";

const EMPTY = tablesSettingsSchema.parse({});

describe("applyTableLayoutOp", () => {
  it("stores a table's column order and hidden columns", () => {
    const next = applyTableLayoutOp(EMPTY, {
      op: "set",
      table: "ec2-instances",
      layout: { order: ["state", "name"], hidden: ["type"], shown: [] },
    });
    expect(next.layouts["ec2-instances"]).toEqual({
      order: ["state", "name"],
      hidden: ["type"],
      shown: [],
    });
  });

  it("resets one table without touching another", () => {
    const both: TableLayoutOp[] = [
      { op: "set", table: "a", layout: { order: ["x"], hidden: [], shown: [] } },
      { op: "set", table: "b", layout: { order: ["y"], hidden: [], shown: [] } },
    ];
    const set = both.reduce((state, op) => applyTableLayoutOp(state, op), EMPTY);
    const reset = applyTableLayoutOp(set, { op: "reset", table: "a" });
    expect(Object.keys(reset.layouts)).toEqual(["b"]);
  });

  it("stops accepting new tables past the cap, but still updates known ones", () => {
    let state = EMPTY;
    for (let i = 0; i < MAX_TABLE_LAYOUTS; i++) {
      state = applyTableLayoutOp(state, {
        op: "set",
        table: `t${i}`,
        layout: { order: [], hidden: [], shown: [] },
      });
    }
    const extra = applyTableLayoutOp(state, {
      op: "set",
      table: "one-too-many",
      layout: { order: [], hidden: [], shown: [] },
    });
    expect(extra.layouts["one-too-many"]).toBeUndefined();
    const known = applyTableLayoutOp(state, {
      op: "set",
      table: "t0",
      layout: { order: ["a"], hidden: [], shown: [] },
    });
    expect(known.layouts["t0"]?.order).toEqual(["a"]);
  });
});

describe("tables in the settings file", () => {
  it("arrives as an empty, defaulted section in a file written before it existed", () => {
    expect(settingsSchema.parse({ version: 1 }).tables).toEqual({ layouts: {} });
  });

  it("costs one unreadable layout only itself", () => {
    const parsed = settingsSchema.parse({
      tables: { layouts: { good: { order: ["a"], hidden: [], shown: [] }, bad: "nonsense" } },
    });
    expect(Object.keys(parsed.tables.layouts)).toEqual(["good"]);
  });

  it("is not changed through the patch schema, which would replace the whole map", () => {
    expect(settingsPatchSchema.safeParse({ tables: { layouts: {} } }).success).toBe(false);
  });
});
