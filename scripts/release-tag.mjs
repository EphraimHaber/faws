/**
 * Tags the app's current version if it has no tag yet, and says which tag it
 * made. Run by the version workflow once the "Version packages" pull request
 * has merged; a no-op on every other push to master.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { version } = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "apps", "desktop", "package.json"), "utf8"),
);
const tag = `v${version}`;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const exists = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`).length > 0;
if (exists || version === "0.0.0") {
  console.log(`Nothing to tag (${tag} ${exists ? "exists" : "is unreleased"}).`);
} else {
  git("tag", "-a", tag, "-m", `faws ${version}`);
  git("push", "origin", tag);
  console.log(`Tagged ${tag}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
}
