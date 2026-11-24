/**
 * Every settings file a released build could have written still reads back.
 *
 * Each `__fixtures__/settings-v<N>.json` is a frozen copy of a real file at
 * version N, and is never edited once committed. This test runs each one
 * through the migration chain and today's schema, and checks that the values
 * it holds survive. Adding a migration is: freeze a fixture at the old version
 * first, then write the migration until this test is green again.
 *
 * `survives` names, per version, where each value should land today and what
 * it should be; a migration that moves a value moves its `read` with it.
 */
import fs from "node:fs";
import path from "node:path";

import { SETTINGS_VERSION, type Settings, settingsSchema } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { migrateToCurrent } from "./migrations.ts";

const FIXTURES = path.join(import.meta.dirname, "__fixtures__");

interface Survival {
  readonly read: (settings: Settings) => unknown;
  readonly values: unknown;
}

const survives: Record<number, Survival> = {
  1: {
    read: (s) => ({
      aws: s.providers.aws,
      kubernetes: s.providers.kubernetes,
      onboarding: s.onboarding.completed,
      refresh: s.refresh.seconds,
      logs: s.logs,
      theme: s.appearance.theme,
      sidebar: s.layout.sidebarWidth,
      terminal: s.terminal,
      linger: s.ecs.deployedLingerSeconds,
    }),
    values: {
      aws: { enabled: true, scope: { profile: "prod", region: "eu-west-1" } },
      kubernetes: { enabled: false, scope: { context: "lab", namespace: "payments" } },
      onboarding: true,
      refresh: 60,
      logs: { timestamps: "full", gutter: 90, taskGutter: 128 },
      theme: "light",
      sidebar: 300,
      terminal: { dockHeight: 320, recordByDefault: false, ssmBash: true },
      linger: 300,
    },
  },
};

const fixtures = fs
  .readdirSync(FIXTURES)
  .map((name) => /^settings-v(\d+)\.json$/.exec(name))
  .filter((match): match is RegExpExecArray => match !== null)
  .map((match) => ({ file: match[0], version: Number(match[1]) }));

describe("frozen settings files", () => {
  it("include one written by the current version", () => {
    expect(fixtures.map((f) => f.version)).toContain(SETTINGS_VERSION);
  });

  it.each(fixtures)("$file reads back with its values intact", ({ file, version }) => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
    const migrated = migrateToCurrent(raw);
    expect(migrated.from).toBe(version);

    const settings = settingsSchema.parse(migrated.data);
    const survival = survives[version];
    expect(survival, `no expectations written for v${version}`).toBeDefined();
    expect(survival!.read(settings)).toEqual(survival!.values);
  });
});
