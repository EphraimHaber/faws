/**
 * Fails when any workspace package.json names a dependency version directly.
 *
 * Every external dependency is declared once in pnpm-workspace.yaml and
 * referenced as `catalog:` or `catalog:<family>`; internal packages are
 * `workspace:*`. `catalogMode: strict` makes `pnpm add` follow this, and this
 * check catches a hand edit that does not.
 */
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
const globs = [...workspace.matchAll(/^\s+-\s+(\S+)$/gm)].map((m) => m[1]);

const manifests = [
  "package.json",
  ...globs.flatMap((g) => globSync(join(g, "package.json"), { cwd: root })),
];

const FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const problems = [];
for (const file of manifests) {
  const pkg = JSON.parse(readFileSync(join(root, file), "utf8"));
  for (const field of FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (spec.startsWith("catalog:") || spec.startsWith("workspace:")) continue;
      problems.push(`${file} ${field}.${name} = "${spec}"`);
    }
  }
}

if (problems.length > 0) {
  console.error("Dependencies must use catalog: or workspace: specifiers:");
  for (const p of problems) console.error(`  ${p}`);
  console.error("Add the version to pnpm-workspace.yaml and reference it with catalog:.");
  process.exit(1);
}
console.log(`check-catalog: ${manifests.length} manifests, all on catalog: or workspace:`);
