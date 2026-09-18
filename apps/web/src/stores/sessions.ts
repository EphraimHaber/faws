/**
 * The terminal dock's tabs, and the sockets behind them.
 *
 * State here is plain data, reduced by lib/terminal/sessions-model. The live
 * objects - the socket per tab - sit in a module-level map alongside it, for
 * the same reason the xterm instances do: nothing that can hold a secret or a
 * DOM node belongs in something devtools will serialise.
 *
 * Sessions deliberately do not survive a page reload. The socket is
 * `reconnection: false` and the server closes a driver when its grace window
 * lapses, so re-adopting would need the client to re-handshake every tab on
 * boot - and a reload is rare and usually deliberate. What does survive is the
 * descriptor of recent targets, so reopening one is a keystroke. The server's
 * reattach path exists and works; wiring it here is a later, small change.
 */
import type { ExecPromptResponse } from "@faws/contracts";
import { z } from "zod";
import { create } from "zustand";

import { readStored, writeStored } from "~/lib/stored";
import { createExecSocket, toUint8, type ExecSocket } from "~/lib/socket";
import {
  addSession,
  applyStatus,
  closeSession as closeInModel,
  EMPTY_SESSIONS,
  markUnread,
  setActive as setActiveInModel,
  setRecordingPath,
  type SessionsState,
  type TerminalSession,
} from "~/lib/terminal/sessions-model";
import { buildHandshake, describeTarget, type ExecTarget } from "~/lib/terminal/handshake";
import {
  createTerminal,
  disposeTerminal,
  freezeTerminal,
  safeFit,
  writeToTerminal,
} from "~/lib/terminal/xterm";

const HEIGHT_KEY = "faws:terminal:height";
const RECORD_KEY = "faws:terminal:record";

/** Tall enough for a shell prompt and a few lines of output. */
export const MIN_DOCK_HEIGHT = 120;
const DEFAULT_DOCK_HEIGHT = 280;

const storedHeight = z.coerce.number().min(MIN_DOCK_HEIGHT).catch(DEFAULT_DOCK_HEIGHT);
const storedRecord = z
  .string()
  .transform((value) => value !== "0")
  .catch(true);

/** Sockets, kept out of state for the same reason terminals are. */
const sockets = new Map<string, ExecSocket>();

interface SessionsStore extends SessionsState {
  readonly height: number;
  readonly dockOpen: boolean;
  readonly fullscreen: boolean;
  /** True while a terminal's textarea actually has DOM focus. */
  readonly focused: boolean;
  readonly recordByDefault: boolean;

  open(target: ExecTarget): string;
  close(id: string): void;
  setActive(id: string): void;
  activateRelative(delta: number): void;
  setHeight(height: number): void;
  toggleDock(open?: boolean): void;
  toggleFullscreen(): void;
  setFocused(focused: boolean): void;
  setRecordByDefault(record: boolean): void;
  answerPrompt(id: string, response: ExecPromptResponse): void;
  /** Reconnects a tab to the same target, reusing the tab. */
  retry(id: string): void;
  byId(id: string): TerminalSession | undefined;
}

export const useSessions = create<SessionsStore>((set, get) => {
  function patch(next: (state: SessionsState) => SessionsState): void {
    set((state) => ({ ...state, ...next(state) }));
  }

  function connect(id: string, target: ExecTarget): void {
    const runtime = createTerminal(id, {
      onData: (chunk) => sockets.get(id)?.emit("exec:input", { chunk }),
      onResize: (cols, rows) => sockets.get(id)?.emit("exec:resize", { cols, rows }),
      onFocusChange: (focused) => set({ focused }),
    });

    const socket = createExecSocket(
      buildHandshake(target, {
        sessionId: id,
        cols: runtime.term.cols,
        rows: runtime.term.rows,
        record: get().recordByDefault,
      }),
    );
    sockets.set(id, socket);

    socket.on("exec:ready", () => {
      patch((state) => applyStatus(state, id, "ready"));
      // Always re-sent, even though the handshake carried a size: the pane may
      // not have settled when it was measured, and the server may have spent
      // several seconds connecting. One emit removes a whole class of "why is
      // my prompt wrapping at column 80".
      const fitted = safeFit(id);
      if (fitted) socket.emit("exec:resize", fitted);
    });

    socket.on("exec:data", ({ chunk }) => {
      const bytes = toUint8(chunk);
      if (!bytes) return;
      writeToTerminal(id, bytes);
      patch((state) => markUnread(state, id));
    });

    socket.on("exec:status", ({ message }) => {
      // The recording path arrives as a status line; lift it out so the dock
      // can show that recording is on rather than burying it in the scrollback.
      const recording = /^Recording to (.+)$/.exec(message);
      if (recording?.[1]) {
        patch((state) => setRecordingPath(state, id, recording[1] ?? null));
        return;
      }
      const current = get().byId(id)?.status ?? "connecting";
      patch((state) => applyStatus(state, id, current, { statusMessage: message }));
    });

    socket.on("exec:prompt", (prompt) => {
      patch((state) => applyStatus(state, id, "awaiting-prompt", { prompt }));
    });

    socket.on("exec:exit", ({ code, reason }) => {
      freezeTerminal(id);
      patch((state) => applyStatus(state, id, "exited", { exit: { code, reason } }));
    });

    socket.on("exec:error", ({ code, userMessage }) => {
      freezeTerminal(id);
      patch((state) => applyStatus(state, id, "errored", { error: { code, userMessage } }));
    });

    socket.on("disconnect", () => {
      const session = get().sessions.find((entry) => entry.id === id);
      if (!session || session.status === "exited" || session.status === "errored") return;
      freezeTerminal(id);
      patch((state) =>
        applyStatus(state, id, "exited", { exit: { code: null, reason: "connection closed" } }),
      );
    });
  }

  return {
    ...EMPTY_SESSIONS,
    height: readStored(HEIGHT_KEY, storedHeight),
    dockOpen: false,
    fullscreen: false,
    focused: false,
    recordByDefault: readStored(RECORD_KEY, storedRecord),

    open(target) {
      const id = crypto.randomUUID();
      const { title, subtitle } = describeTarget(target);
      targets.set(id, target);
      patch((state) =>
        addSession(state, {
          id,
          kind: target.kind,
          title,
          subtitle,
          recordingPath: null,
          statusMessage: null,
        }),
      );
      set({ dockOpen: true });
      connect(id, target);
      return id;
    },

    close(id) {
      const socket = sockets.get(id);
      // Order matters: tell the server before dropping the socket, or the
      // driver only learns from the disconnect and the far end lingers.
      socket?.emit("exec:close");
      socket?.disconnect();
      sockets.delete(id);
      targets.delete(id);
      disposeTerminal(id);
      patch((state) => closeInModel(state, id));
      if (get().sessions.length === 0) set({ dockOpen: false, fullscreen: false });
    },

    setActive(id) {
      patch((state) => setActiveInModel(state, id));
    },

    activateRelative(delta) {
      const { sessions, activeId } = get();
      if (sessions.length === 0) return;
      const index = sessions.findIndex((session) => session.id === activeId);
      const next = sessions[(index + delta + sessions.length) % sessions.length];
      if (next) patch((state) => setActiveInModel(state, next.id));
    },

    setHeight(height) {
      const clamped = Math.max(MIN_DOCK_HEIGHT, Math.round(height));
      set({ height: clamped });
      writeStored(HEIGHT_KEY, String(clamped));
    },

    toggleDock(open) {
      set((state) => ({ dockOpen: open ?? !state.dockOpen }));
    },

    toggleFullscreen() {
      set((state) => ({ fullscreen: !state.fullscreen }));
    },

    setFocused(focused) {
      set({ focused });
    },

    setRecordByDefault(record) {
      set({ recordByDefault: record });
      writeStored(RECORD_KEY, record ? "1" : "0");
    },

    answerPrompt(id, response) {
      sockets.get(id)?.emit("exec:prompt:response", response);
      patch((state) => applyStatus(state, id, "connecting"));
    },

    retry(id) {
      const target = targets.get(id);
      if (!target) return;
      sockets.get(id)?.disconnect();
      sockets.delete(id);
      disposeTerminal(id);
      patch((state) => closeInModel(state, id));
      get().open(target);
    },

    byId(id: string): TerminalSession | undefined {
      return get().sessions.find((session) => session.id === id);
    },
  };
});

/** What each tab is connected to, so a retry can rebuild the same handshake. */
const targets = new Map<string, ExecTarget>();

/** True while a terminal has focus, so page shortcuts can stand down. */
export function useTerminalFocused(): boolean {
  return useSessions((state) => state.focused);
}
