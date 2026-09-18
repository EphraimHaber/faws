/**
 * Copies node-pty into `dist/node_modules/` for packaging.
 *
 * tsdown bundles everything else into one .mjs, but a native module cannot be
 * bundled: node-pty resolves its own `.node` binding relative to its package
 * directory, so that directory has to exist next to the built server. It is
 * copied dereferenced because pnpm's node_modules is a forest of symlinks, and
 * electron-builder would otherwise carry a link to a store path that is not in
 * the app bundle.
 *
 * The existing `extraResources: [{ from: ../server/dist, to: server }]` then
 * picks it up with no electron-builder change at all.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const require = createRequire(import.meta.url);

function stage(name) {
  let from;
  try {
    from = path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    console.warn(`${name} is not installed; skipping (exec will fall back to pipes)`);
    return;
  }

  const to = path.join(dist, "node_modules", name);
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });

  // See scripts/fix-native-perms.mjs - the prebuild ships this as 0644.
  for (const helper of fs.globSync(path.join(to, "prebuilds", "*", "spawn-helper"))) {
    fs.chmodSync(helper, 0o755);
  }
  console.log(`staged ${name}`);
}

stage("node-pty");
