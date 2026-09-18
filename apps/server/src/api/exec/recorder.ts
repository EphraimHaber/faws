/**
 * Writes a session to an asciicast v2 file.
 *
 * The format is one JSON header line then one JSON array per event, which means
 * it can be appended to as the session runs and stays valid if the process dies
 * mid-write - the right property for a transcript, and the reason not to invent
 * something here. `asciinema play` reads the result directly.
 *
 * Two decisions worth stating plainly, because both are about somebody else's
 * privacy rather than about correctness:
 *
 * Input is **not** recorded unless `FAWS_EXEC_RECORD_INPUT=1`. A session's
 * input stream contains the password typed at a `sudo` prompt, which no echo
 * suppression on the far end can keep out of a local recording.
 *
 * Recording is visible before it starts, never switched on quietly. The UI
 * shows the toggle and the path; this module just refuses to be silent about it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { recordingsDir } from "@faws/shared/dataDir";

import { createLogger } from "../../shared/logger.ts";

const log = createLogger("exec");

/** Past this, stop recording and keep the shell running. */
const MAX_BYTES = envInt("FAWS_EXEC_RECORD_MAX_BYTES", 32 * 1024 * 1024);
const RETENTION_DAYS = envInt("FAWS_EXEC_RECORD_RETENTION_DAYS", 30);
/** Batched so a keystroke is not a syscall. */
const FLUSH_MS = 50;

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RecorderMeta {
  readonly sessionId: string;
  readonly kind: string;
  readonly target: string;
  readonly profile: string | null;
  readonly region: string | null;
  readonly cols: number;
  readonly rows: number;
}

export interface Recorder {
  readonly path: string;
  output(chunk: Uint8Array): void;
  input(chunk: Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/** `prod/web-1/app` is a fine label and a terrible filename. */
function slug(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session"
  );
}

export function startRecording(meta: RecorderMeta): Recorder | null {
  if (process.env["FAWS_EXEC_RECORD"] === "0") return null;

  const startedAt = new Date();
  const day = startedAt.toISOString().slice(0, 10);
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const dir = path.join(recordingsDir(), day);
  const file = path.join(dir, `${stamp}-${meta.kind}-${slug(meta.target)}-${meta.sessionId}.cast`);

  let stream: fs.WriteStream;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    stream = fs.createWriteStream(file, { flags: "a", mode: 0o600 });
  } catch (err) {
    // A transcript is worth having, but never worth failing a session over.
    log.warn({ err, file }, "could not start recording");
    return null;
  }

  const recordInput = process.env["FAWS_EXEC_RECORD_INPUT"] === "1";
  // One decoder per direction, held across chunks: a UTF-8 code point split
  // across two reads must not become two replacement characters in the file.
  const outDecoder = new StringDecoder("utf8");
  const inDecoder = new StringDecoder("utf8");

  const begun = Date.now();
  let written = 0;
  let stopped = false;
  let pending: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  stream.write(
    `${JSON.stringify({
      version: 2,
      width: meta.cols,
      height: meta.rows,
      timestamp: Math.floor(begun / 1000),
      env: { TERM: "xterm-256color" },
      title: `${meta.kind} ${meta.target}`,
      // Extra top-level keys are legal in v2, and this is what makes a
      // recording self-describing once it is out of the app.
      faws: {
        sessionId: meta.sessionId,
        kind: meta.kind,
        target: meta.target,
        profile: meta.profile,
        region: meta.region,
      },
    })}\n`,
  );

  function flush(): void {
    flushTimer = null;
    if (pending.length === 0) return;
    const batch = pending.join("");
    pending = [];
    stream.write(batch);
  }

  function emit(event: unknown): void {
    if (stopped) return;
    const line = `${JSON.stringify(event)}\n`;
    written += Buffer.byteLength(line);
    pending.push(line);
    if (written >= MAX_BYTES) {
      stop(true);
      return;
    }
    flushTimer ??= setTimeout(flush, FLUSH_MS);
  }

  function stop(truncated: boolean): void {
    if (stopped) return;
    stopped = true;
    if (flushTimer) clearTimeout(flushTimer);
    if (truncated) {
      pending.push(
        `${JSON.stringify([elapsed(), "o", "\r\n[faws] recording stopped: size limit reached\r\n"])}\n`,
      );
      log.warn({ file }, "recording hit its size limit; the session continues");
    }
    flush();
    stream.end();
  }

  function elapsed(): number {
    return (Date.now() - begun) / 1000;
  }

  return {
    path: file,
    output(chunk) {
      const text = outDecoder.write(Buffer.from(chunk));
      if (text.length > 0) emit([elapsed(), "o", text]);
    },
    input(chunk) {
      if (!recordInput) return;
      const text = inDecoder.write(Buffer.from(chunk));
      if (text.length > 0) emit([elapsed(), "i", text]);
    },
    resize(cols, rows) {
      emit([elapsed(), "r", `${cols}x${rows}`]);
    },
    close() {
      stop(false);
    },
  };
}

/**
 * Deletes recordings past the retention window.
 *
 * Run at startup rather than on a timer: a desktop app is not running when
 * nobody is using it, so a nightly sweep would simply never fire.
 */
export function sweepRecordings(): void {
  const root = recordingsDir();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  let days: string[];
  try {
    days = fs.readdirSync(root);
  } catch {
    return; // Nothing recorded yet.
  }

  for (const day of days) {
    const dir = path.join(root, day);
    try {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (fs.statSync(file).mtimeMs >= cutoff) continue;
        fs.rmSync(file);
        removed += 1;
      }
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (err) {
      log.warn({ err, dir }, "could not sweep recordings");
    }
  }

  if (removed > 0) log.info({ removed, retentionDays: RETENTION_DAYS }, "swept old recordings");
}
