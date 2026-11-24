/**
 * Writes a changeset for the app without the interactive prompt.
 *
 *   pnpm change "One plain sentence about what the user sees" [patch|minor|major]
 *
 * The app is the only thing released, so every note names `@faws/desktop`;
 * asking which package each time would be a question with one answer.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [summary, kind = "patch"] = process.argv.slice(2);
const KINDS = ["patch", "minor", "major"];

if (!summary || !KINDS.includes(kind)) {
  console.error('Usage: pnpm change "What the user will notice" [patch|minor|major]');
  process.exit(1);
}

const slug =
  summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "change";
const file = join(import.meta.dirname, "..", ".changeset", `${slug}.md`);

writeFileSync(file, `---\n"@faws/desktop": ${kind}\n---\n\n${summary.trim()}\n`, { flag: "wx" });
console.log(`Wrote .changeset/${slug}.md (${kind})`);
