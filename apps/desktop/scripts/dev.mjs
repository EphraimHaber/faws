#!/usr/bin/env node
/**
 * Desktop dev: bundle main/preload in watch mode, then launch Electron once
 * the first build has landed on disk.
 *
 * This is a script rather than two parallel package scripts because Electron
 * needs `dist-electron/main.cjs` to exist before it starts, and a plain
 * parallel run races it.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const entry = path.join(root, "dist-electron", "main.cjs");
const bin = (name) => path.join(root, "node_modules", ".bin", name);

const children = [];

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const bundler = spawn(bin("tsdown"), ["--watch"], { cwd: root, stdio: "inherit" });
children.push(bundler);

async function waitForEntry(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(entry)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

if (!(await waitForEntry())) {
  console.error("[desktop] timed out waiting for dist-electron/main.cjs");
  shutdown(1);
}

const electron = spawn(bin("electron"), [entry], { cwd: root, stdio: "inherit", env: process.env });
children.push(electron);
electron.on("exit", (code) => shutdown(code ?? 0));
