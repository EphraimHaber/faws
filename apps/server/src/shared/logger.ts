/**
 * One root pino instance fanned out to three destinations:
 *   1. stdout - pretty in dev, raw JSON in prod (the desktop main process
 *      ingests those lines into its own file log).
 *   2. broadcast - a Writable the Socket.IO layer wires to a `log:line`
 *      emit, which is what the in-app log viewer tails.
 *   3. file - `${FAWS_DATA_DIR}/logs/faws-server.log`, skipped under
 *      Electron prod where main is already mirroring stdout.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { logsDir } from "@faws/shared/dataDir";
import pino from "pino";
import pretty from "pino-pretty";

const isDevelopment = (process.env["NODE_ENV"] ?? "development") === "development";
const isUnderElectron = process.env["ELECTRON_RUN_AS_NODE"] === "1";
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let broadcaster: ((line: string) => void) | null = null;

export function setLogBroadcaster(fn: ((line: string) => void) | null): void {
  broadcaster = fn;
}

const broadcastStream = {
  write(chunk: string): void {
    if (!broadcaster) return;
    const line = chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk;
    if (line.length === 0) return;
    try {
      broadcaster(line);
    } catch {
      /* a broken socket must never take the logger down */
    }
  },
};

function buildStreams(): Array<{ stream: unknown; level: pino.Level }> {
  const streams: Array<{ stream: unknown; level: pino.Level }> = [
    { stream: isDevelopment ? pretty({ colorize: true }) : process.stdout, level: "trace" },
    { stream: broadcastStream, level: "trace" },
  ];

  if (isUnderElectron) return streams;
  try {
    const dir = logsDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "faws-server.log");
    rotateIfLarge(filePath);
    streams.push({
      stream: pino.destination({ dest: filePath, sync: false, append: true, mkdir: true }),
      level: "trace",
    });
  } catch (err) {
    process.stderr.write(`[logger] file destination unavailable: ${String(err)}\n`);
  }
  return streams;
}

function rotateIfLarge(filePath: string): void {
  try {
    if (fs.statSync(filePath).size <= MAX_LOG_BYTES) return;
    const rotated = `${filePath}.old`;
    try {
      fs.unlinkSync(rotated);
    } catch {
      /* no previous rotation */
    }
    fs.renameSync(filePath, rotated);
  } catch {
    /* file doesn't exist yet */
  }
}

const baseLogger = pino(
  {
    name: "faws-server",
    level: process.env["LOG_LEVEL"] ?? (isDevelopment ? "debug" : "info"),
    serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
  },
  pino.multistream(buildStreams() as Parameters<typeof pino.multistream>[0]),
);

export type BaseLogger = typeof baseLogger;

export function getRootLogger(): BaseLogger {
  return baseLogger;
}

export const createLogger = (name: string): BaseLogger => baseLogger.child({ name });
