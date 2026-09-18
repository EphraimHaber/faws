/**
 * Restores the executable bit on node-pty's `spawn-helper`.
 *
 * node-pty's macOS and Linux prebuilds ship the helper as 0644, and neither npm
 * nor pnpm preserves the mode from the tarball. Without the bit, every pty
 * spawn fails with a bare "posix_spawnp failed" - an error that names no file
 * and says nothing about permissions, which makes it a genuinely nasty hour to
 * diagnose. Cheaper to fix on every install than to explain once.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
  const root = path.dirname(require.resolve("node-pty/package.json"));
  const helpers = fs.globSync(path.join(root, "prebuilds", "*", "spawn-helper"));
  for (const helper of helpers) fs.chmodSync(helper, 0o755);
} catch {
  // node-pty is an optional dependency; its absence is a supported state and
  // the exec layer falls back to plain pipes.
}
