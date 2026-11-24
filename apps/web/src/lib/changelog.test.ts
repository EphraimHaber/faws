import { describe, expect, it } from "vitest";

import { changesBetween, compareVersions, parseChangelog } from "./changelog";

const SAMPLE = `# @faws/desktop

## 0.3.0

### Minor Changes

- [#12](https://github.com/EphraimHaber/faws/pull/12) [\`abc1234\`](https://github.com/EphraimHaber/faws/commit/abc1234) Thanks [@someone](https://github.com/someone)! - Show each provider's health on the overview

  With a second paragraph.

### Patch Changes

- Fix the refresh button spinning forever

## 0.2.0

### Minor Changes

- Switch providers off in Settings
`;

describe("parseChangelog", () => {
  const parsed = parseChangelog(SAMPLE);

  it("splits versions and their sections, newest first as written", () => {
    expect(parsed.map((v) => v.version)).toEqual(["0.3.0", "0.2.0"]);
    expect(parsed[0]!.sections.map((s) => s.title)).toEqual(["Minor Changes", "Patch Changes"]);
  });

  it("keeps an entry's continuation lines with it", () => {
    const entry = parsed[0]!.sections[0]!.entries[0]!.text;
    expect(entry).toContain("Show each provider's health");
    expect(entry).toContain("With a second paragraph.");
  });

  it("reads a changelog with no versions yet as empty", () => {
    expect(parseChangelog("# @faws/desktop\n")).toEqual([]);
  });
});

describe("compareVersions", () => {
  it("orders by numbers, not text, and puts a pre-release before its release", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  });
});

describe("changesBetween", () => {
  it("lists what changed since the last version seen, up to the running one", () => {
    expect(changesBetween(parseChangelog(SAMPLE), "0.1.0", "0.3.0").map((v) => v.version)).toEqual([
      "0.3.0",
      "0.2.0",
    ]);
    expect(changesBetween(parseChangelog(SAMPLE), "0.2.0", "0.3.0").map((v) => v.version)).toEqual([
      "0.3.0",
    ]);
  });
});
