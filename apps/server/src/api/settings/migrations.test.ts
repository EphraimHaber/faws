import { SETTINGS_VERSION } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { MIGRATIONS, migrateToCurrent, readVersion } from "./migrations.ts";

describe("the migration chain", () => {
  /**
   * The test that actually earns its keep: it fails the moment someone bumps
   * `SETTINGS_VERSION` without adding the migration that reads the old file,
   * which is the realistic way this goes wrong.
   */
  it("is contiguous from 2 and ends at the current version", () => {
    expect(MIGRATIONS.map((m) => m.to)).toEqual(
      Array.from({ length: SETTINGS_VERSION - 1 }, (_, i) => i + 2),
    );
  });

  it("stamps the current version onto whatever it produces", () => {
    expect(migrateToCurrent({ version: 1 }).data["version"]).toBe(SETTINGS_VERSION);
  });

  it("applies nothing to a file already at the current version", () => {
    expect(migrateToCurrent({ version: SETTINGS_VERSION }).applied).toEqual([]);
  });
});

describe("readVersion", () => {
  it("reads an integer version", () => {
    expect(readVersion({ version: 3 })).toBe(3);
  });

  it("treats a missing or nonsensical version as the oldest we shipped", () => {
    expect(readVersion({})).toBe(1);
    expect(readVersion({ version: "two" })).toBe(1);
    expect(readVersion({ version: 1.5 })).toBe(1);
    expect(readVersion({ version: 0 })).toBe(1);
  });
});
