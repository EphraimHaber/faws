/**
 * Running a Kubernetes CLI for its JSON, rather than for a terminal.
 *
 * `execFile`, never `exec`: there is no shell in the middle, so an argument is
 * an argument and nothing in it is ever interpreted. That is the same property
 * the argv builder depends on, stated once here so every read path gets it too.
 *
 * Both limits exist because the command talks to a network. A context pointing
 * at a cluster behind a VPN that is not up does not fail, it hangs, and a
 * pre-flight check that hangs is worse than one that says no. The output cap is
 * the other end of the same thought: `get pods -o json` on a large namespace is
 * megabytes, and a runaway read should fail rather than become the process's
 * memory profile.
 */
import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;

export interface KubeCliOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** A command that ran and refused, carrying what it said about it. */
export class KubeCliError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(message: string, options: { exitCode: number | null; stderr: string }) {
    super(message);
    this.name = "KubeCliError";
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
  }
}

export function runKubeJson<T>(
  file: string,
  args: readonly string[],
  options: KubeCliOptions = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_STDOUT_BYTES,
        ...(options.signal ? { signal: options.signal } : {}),
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          const exitCode =
            typeof (err as { code?: unknown }).code === "number"
              ? (err as { code: number }).code
              : null;
          // stderr first: `kubectl`'s own message names the cause, while the
          // Error's message only says the command failed.
          const said = stderr.trim() || err.message;
          const failure = new KubeCliError(said, { exitCode, stderr: said });
          // Keep a spawn failure's own code, which is how a missing binary is
          // told apart from a cluster that refused.
          if (typeof (err as { code?: unknown }).code === "string") {
            Object.assign(failure, { code: (err as { code: string }).code });
          }
          reject(failure);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(new KubeCliError(`${file} did not return JSON.`, { exitCode: 0, stderr: "" }));
        }
      },
    );
  });
}
