/**
 * Prints one version's section of the app's changelog, for a release body.
 *
 *   node scripts/release-notes.mjs 0.2.0 > notes.md
 *
 * The section is everything between that version's `## ` heading and the next
 * one, which is the shape `@changesets/cli` writes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!version) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

const changelog = readFileSync(
  join(import.meta.dirname, "..", "apps", "desktop", "CHANGELOG.md"),
  "utf8",
);
const lines = changelog.split("\n");
const start = lines.findIndex((line) => line.trim() === `## ${version}`);
if (start === -1) {
  console.error(`No "## ${version}" section in apps/desktop/CHANGELOG.md`);
  process.exit(1);
}
const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
console.log(
  lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim(),
);
