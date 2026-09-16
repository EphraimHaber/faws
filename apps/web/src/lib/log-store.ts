import * as React from "react";
import { create } from "zustand";

import { getSocket } from "./socket.ts";

export interface ServerLogLine {
  readonly id: number;
  readonly level: string;
  readonly name: string;
  readonly time: string;
  readonly msg: string;
  readonly raw: string;
}

const LEVEL_NAMES: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

interface LogStore {
  readonly lines: ReadonlyArray<ServerLogLine>;
  append(raw: string): void;
  clear(): void;
}

/** Ring buffer: the server can out-produce the renderer during a big list. */
const MAX_LINES = 2000;
let nextId = 0;

export const useLogStore = create<LogStore>((set) => ({
  lines: [],
  append: (raw) =>
    set((state) => {
      const parsed = parseLine(raw);
      const next = [...state.lines, parsed];
      return { lines: next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next };
    }),
  clear: () => set({ lines: [] }),
}));

function parseLine(raw: string): ServerLogLine {
  try {
    const record = JSON.parse(raw) as Record<string, unknown>;
    return {
      id: nextId++,
      level: LEVEL_NAMES[Number(record["level"])] ?? String(record["level"] ?? "info"),
      name: String(record["name"] ?? "server"),
      time: new Date(Number(record["time"]) || Date.now()).toISOString(),
      msg: String(record["msg"] ?? ""),
      raw,
    };
  } catch {
    return {
      id: nextId++,
      level: "info",
      name: "server",
      time: new Date().toISOString(),
      msg: raw,
      raw,
    };
  }
}

/**
 * Mounted once at the root so log capture doesn't depend on the log page
 * being open — otherwise you navigate to /logs after something breaks and
 * find an empty pane.
 */
export function useLogIngest(): void {
  React.useEffect(() => {
    const socket = getSocket();
    const handler = (payload: { json: string }) => useLogStore.getState().append(payload.json);
    socket.on("log:line", handler);
    return () => {
      socket.off("log:line", handler);
    };
  }, []);
}
