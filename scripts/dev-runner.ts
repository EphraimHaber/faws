/**
 * dev-runner - orchestrates the multi-process dev session.
 *
 *   node scripts/dev-runner.ts dev          # server + web + desktop
 *   node scripts/dev-runner.ts dev:webapp   # server + web, no desktop
 *   node scripts/dev-runner.ts dev:server   # server only
 *   node scripts/dev-runner.ts dev:web      # web only (talks to a running server)
 *   node scripts/dev-runner.ts dev:desktop  # desktop only
 *
 * Ports come from FAWS_DEV_SERVER_PORT / FAWS_DEV_WEB_PORT.
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");

const SERVER_PORT = process.env["FAWS_DEV_SERVER_PORT"] ?? "4741";
const WEB_PORT = process.env["FAWS_DEV_WEB_PORT"] ?? "5741";
const HOST = process.env["FAWS_DEV_HOST"] ?? "127.0.0.1";
// A stable home for dev state so it survives a node_modules wipe.
const DATA_DIR = process.env["FAWS_DEV_DATA_DIR"] ?? path.join(os.homedir(), ".faws-dev");

const colors = ["[36m", "[32m", "[35m"] as const;
const reset = "[0m";

interface ProcSpec {
  readonly name: string;
  readonly cwd: string;
  readonly cmd: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
}

const children: ChildProcess[] = [];

function spawnProc(spec: ProcSpec, color: string): void {
  const child = spawn(spec.cmd, [...spec.args], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = `${color}[${spec.name}]${reset}`;

  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) process.stdout.write(`${tag} ${line}\n`);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) process.stderr.write(`${tag} ${line}\n`);
    }
  });
  // One process dying takes the session down: a half-running dev stack is
  // more confusing than a clean exit.
  child.on("exit", (code) => {
    process.stderr.write(`${tag} exited (code=${code ?? "null"})\n`);
    for (const sibling of children) {
      if (sibling !== child && !sibling.killed) sibling.kill();
    }
    process.exit(code ?? 0);
  });

  children.push(child);
}

function shutdown(): void {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

const serverSpec: ProcSpec = {
  name: "server",
  cwd: path.join(ROOT, "apps", "server"),
  cmd: "node",
  args: ["--watch", "src/main.ts"],
  env: { FAWS_HOST: HOST, FAWS_PORT: SERVER_PORT, FAWS_DATA_DIR: DATA_DIR },
};

const webSpec: ProcSpec = {
  name: "web",
  cwd: path.join(ROOT, "apps", "web"),
  cmd: "pnpm",
  args: ["run", "dev"],
  env: {
    PORT: WEB_PORT,
    HOST,
    VITE_TRPC_URL: `http://${HOST}:${SERVER_PORT}/trpc`,
  },
};

const desktopSpec: ProcSpec = {
  name: "desktop",
  cwd: path.join(ROOT, "apps", "desktop"),
  cmd: "pnpm",
  args: ["run", "dev"],
  env: {
    VITE_DEV_SERVER_URL: `http://${HOST}:${WEB_PORT}`,
    FAWS_PORT: SERVER_PORT,
    FAWS_DATA_DIR: DATA_DIR,
  },
};

switch (process.argv[2] ?? "dev") {
  case "dev":
    spawnProc(serverSpec, colors[0]);
    spawnProc(webSpec, colors[1]);
    // Give Vite a moment to bind before Electron points a window at it.
    setTimeout(() => spawnProc(desktopSpec, colors[2]), 1500);
    break;
  case "dev:webapp":
    spawnProc(serverSpec, colors[0]);
    spawnProc(webSpec, colors[1]);
    break;
  case "dev:server":
    spawnProc(serverSpec, colors[0]);
    break;
  case "dev:web":
    spawnProc(webSpec, colors[1]);
    break;
  case "dev:desktop":
    spawnProc(desktopSpec, colors[2]);
    break;
  default:
    console.error(`Unknown dev-runner command: ${process.argv[2]}`);
    process.exit(1);
}
