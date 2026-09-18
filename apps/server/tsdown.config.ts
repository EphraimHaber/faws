import { defineConfig } from "tsdown";

/**
 * The desktop shell ships the server as a single .mjs under
 * `process.resourcesPath/server/`, so everything except Node builtins gets
 * bundled in — there is no node_modules next to it at runtime.
 *
 * node-pty is the one exception. A native module cannot be bundled: it resolves
 * its own `.node` binding relative to its package directory, so it has to stay
 * a real directory. `scripts/stage-native.mjs` copies it into `dist/` after the
 * build, which is why `dist/node_modules/node-pty` exists at runtime.
 */
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  outExtensions: () => ({ js: ".mjs" }),
  platform: "node",
  target: "node22",
  noExternal: (id) =>
    !id.startsWith("node:") && !isNodeBuiltin(id) && !id.endsWith(".node") && id !== "node-pty",
  external: [/\.node$/, "node-pty"],
});

const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

function isNodeBuiltin(id: string): boolean {
  const root = id.split("/")[0]!;
  return NODE_BUILTINS.has(root);
}
