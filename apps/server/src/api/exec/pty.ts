/**
 * Spawns a child that believes it is attached to a terminal.
 *
 * This exists for one reason: `session-manager-plugin` only tells the remote
 * end how big the window is when its own stdout is a TTY. It reads the terminal
 * size and installs a SIGWINCH handler, exactly as it would under a shell. Give
 * it plain pipes and there is no size to read and no signal to catch, so the
 * remote PTY stays at its default 80x24 forever and `vim` in a maximised window
 * is unusable. The reference implementation shipped SSM resize as a documented
 * no-op for precisely this reason.
 *
 * Under node-pty the kernel does the work for us: `resize()` sets the winsize
 * on the master fd, the child gets SIGWINCH, and the plugin does the right
 * thing without knowing we exist.
 *
 * node-pty is a native module, so it is loaded through a dynamic import and
 * everything below degrades to plain pipes if that fails. A build where the
 * binding will not load loses resize, not the feature.
 *
 * Note the deliberate limit: this is for *interactive* children only. A tunnel
 * (`AWS-StartSSHSession`) must use plain pipes, because a PTY would apply
 * CR/LF translation and interpret control characters in what is meant to be an
 * opaque byte stream, corrupting the SSH protocol riding over it.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Duplex } from "node:stream";

import { createLogger } from "../../shared/logger.ts";

const log = createLogger("exec");

export interface InteractiveChild {
  onData(listener: (chunk: Uint8Array) => void): void;
  onExit(listener: (code: number | null) => void): void;
  write(chunk: Uint8Array): void;
  resize(cols: number, rows: number): void;
  /** Ends the child, insisting with SIGKILL after the grace period. */
  kill(graceMs: number): Promise<void>;
}

export interface SpawnOptions {
  readonly cols: number;
  readonly rows: number;
  /** Told once, when resize is not going to work after all. */
  onDegraded?(message: string): void;
}

/** Minimal shape of what we use from node-pty, so the import can be typed. */
interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
  ): {
    onData(listener: (data: string) => void): void;
    onExit(listener: (event: { exitCode: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    pid: number;
  };
}

let ptyModule: PtyModule | null | undefined;

async function loadPty(): Promise<PtyModule | null> {
  if (ptyModule !== undefined) return ptyModule;
  try {
    // node-pty is CommonJS, so under ESM its exports land on `default` in some
    // resolutions and on the namespace in others. Take whichever has `spawn`.
    const imported = (await import("node-pty")) as unknown as {
      spawn?: PtyModule["spawn"];
      default?: PtyModule;
    };
    const resolved =
      typeof imported.spawn === "function" ? (imported as PtyModule) : imported.default;
    if (!resolved || typeof resolved.spawn !== "function") {
      throw new Error("node-pty loaded but exposes no spawn()");
    }
    ptyModule = resolved;
  } catch (err) {
    log.warn({ err }, "node-pty unavailable; terminal resize will not reach the remote end");
    ptyModule = null;
  }
  return ptyModule;
}

export async function spawnInteractive(
  file: string,
  args: string[],
  options: SpawnOptions,
): Promise<InteractiveChild> {
  const pty = await loadPty();
  return pty ? spawnWithPty(pty, file, args, options) : spawnWithPipes(file, args, options);
}

function spawnWithPty(
  pty: PtyModule,
  file: string,
  args: string[],
  options: SpawnOptions,
): InteractiveChild {
  const child = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    env: process.env,
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let exited = false;

  return {
    onData: (listener) => child.onData((data) => listener(encoder.encode(data))),
    onExit: (listener) =>
      child.onExit(({ exitCode }) => {
        exited = true;
        listener(exitCode);
      }),
    write: (chunk) => child.write(decoder.decode(chunk)),
    resize: (cols, rows) => {
      // Throws if the child has already gone; that is a race, not an error.
      try {
        child.resize(cols, rows);
      } catch {
        /* the child is gone */
      }
    },
    kill: async (graceMs) => {
      if (exited) return;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      await waitFor(() => exited, graceMs);
      if (!exited) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    },
  };
}

function spawnWithPipes(file: string, args: string[], options: SpawnOptions): InteractiveChild {
  options.onDegraded?.(
    "Running without a pseudo-terminal, so the remote shell will not follow this window's size.",
  );

  const child: ChildProcessWithoutNullStreams = spawn(file, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  return {
    onData: (listener) => {
      child.stdout.on("data", (chunk: Buffer) => listener(new Uint8Array(chunk)));
      // The plugin's own diagnostics go to stderr, and a user staring at a
      // blank terminal needs to see them.
      child.stderr.on("data", (chunk: Buffer) => listener(new Uint8Array(chunk)));
    },
    onExit: (listener) => child.on("exit", (code) => listener(code)),
    write: (chunk) => child.stdin.write(chunk),
    resize: () => {
      /* No TTY, so there is no window size to set. */
    },
    kill: async (graceMs) => {
      if (exited) return;
      child.stdin.end();
      child.kill("SIGTERM");
      await waitFor(() => exited, graceMs);
      if (!exited) child.kill("SIGKILL");
    },
  };
}

function waitFor(done: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (done() || Date.now() - started >= timeoutMs) {
        clearInterval(tick);
        resolve();
      }
    }, 25);
    tick.unref?.();
  });
}

/**
 * Spawns a child whose stdio is an opaque byte pipe.
 *
 * The counterpart to `spawnInteractive`, and deliberately not a pty. This is
 * for a tunnel, where the bytes are a protocol rather than a terminal: a pty
 * would translate line endings and act on control characters, corrupting what
 * it is carrying. Its stderr is kept out of the stream for the same reason -
 * plugin diagnostics mixed into an SSH handshake would break it.
 */
export function spawnTunnel(
  file: string,
  args: string[],
  options: { onStderr(line: string): void },
): { stream: Duplex; kill(): void } {
  const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text.length > 0) options.onStderr(text);
  });
  child.on("error", (err) => log.warn({ err, file }, "tunnel child failed"));

  return {
    stream: Duplex.from({ readable: child.stdout, writable: child.stdin }),
    kill: () => {
      child.stdin.end();
      child.kill("SIGTERM");
    },
  };
}
