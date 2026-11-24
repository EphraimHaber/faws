/**
 * The app's changelog, as written by changesets, split into versions.
 *
 * Bundled at build time, so "What's new" works offline and in an air-gapped
 * install: nothing is fetched to show what the running version changed.
 */
import raw from "../../../desktop/CHANGELOG.md?raw";

export interface ChangelogEntry {
  /** One bullet, markdown as written. */
  readonly text: string;
}

export interface ChangelogSection {
  /** "Major Changes", "Minor Changes", "Patch Changes". */
  readonly title: string;
  readonly entries: ReadonlyArray<ChangelogEntry>;
}

export interface ChangelogVersion {
  readonly version: string;
  readonly sections: ReadonlyArray<ChangelogSection>;
}

export function parseChangelog(markdown: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = [];
  let version: { version: string; sections: ChangelogSection[] } | null = null;
  let section: { title: string; entries: ChangelogEntry[] } | null = null;
  let entry: string[] | null = null;

  const closeEntry = () => {
    if (entry && section) section.entries.push({ text: entry.join("\n").trim() });
    entry = null;
  };

  for (const line of markdown.split("\n")) {
    const versionHeading = /^## (\S+)/.exec(line);
    if (versionHeading) {
      closeEntry();
      version = { version: versionHeading[1]!, sections: [] };
      versions.push(version);
      section = null;
      continue;
    }
    const sectionHeading = /^### (.+)/.exec(line);
    if (sectionHeading && version) {
      closeEntry();
      section = { title: sectionHeading[1]!.trim(), entries: [] };
      version.sections.push(section);
      continue;
    }
    if (!section) continue;
    if (line.startsWith("- ")) {
      closeEntry();
      entry = [line.slice(2)];
    } else if (entry && (line.startsWith("  ") || line.trim() === "")) {
      entry.push(line.replace(/^ {2}/, ""));
    }
  }
  closeEntry();
  return versions;
}

export const CHANGELOG: ReadonlyArray<ChangelogVersion> = parseChangelog(raw);

/** -1, 0 or 1 by semver precedence of the numeric parts; a pre-release sorts first. */
export function compareVersions(a: string, b: string): number {
  const [coreA = "", preA] = a.replace(/^v/, "").split("-", 2);
  const [coreB = "", preB] = b.replace(/^v/, "").split("-", 2);
  const partsA = coreA.split(".").map(Number);
  const partsB = coreB.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : 1;
}

/** The versions after `since` up to and including `upTo`, newest first. */
export function changesBetween(
  changelog: ReadonlyArray<ChangelogVersion>,
  since: string,
  upTo: string,
): ChangelogVersion[] {
  return changelog.filter(
    (entry) =>
      compareVersions(entry.version, since) > 0 && compareVersions(entry.version, upTo) <= 0,
  );
}
