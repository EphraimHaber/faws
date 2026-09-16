import { defineConfig } from "tsdown";

/**
 * The desktop shell ships the server as a single .mjs under
 * `process.resourcesPath/server/`, so everything except Node builtins gets
 * bundled in — there is no node_modules next to it at runtime.
 */
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  outExtensions: () => ({ js: ".mjs" }),
  platform: "node",
  target: "node22",
  noExternal: (id) => !id.startsWith("node:") && !isNodeBuiltin(id) && !id.endsWith(".node"),
  external: [/\.node$/],
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
