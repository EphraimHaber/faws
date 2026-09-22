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
 * boot - and a reload is rare and usually deliberate. The server's reattach
 * path exists and works; wiring it here is a later, small change.
 *
 * The dock's height and its record-by-default toggle are not here either:
 * they are preferences, so they live in the settings store with the rest and
 * follow the person between the browser and the desktop app.
 */
import type { ExecPromptResponse } from "@faws/contracts";

import { create } from "zustand";

import { readStored, writeStored } from "~/lib/stored";
import { createExecSocket, toUint8, type ExecSocket } from "~/lib/socket";
import { settingsSnapshot } from "~/stores/settings";
import {
  addSession,
  applyStatus,
  closeSession as closeInModel,
  displayOrder,
  EMPTY_SESSIONS,
  markUnread,
  setActive as setActiveInModel,
  setRecordingPath,
  type SessionsState,
  type TerminalSession,
} from "~/lib/terminal/sessions-model";
import { buildHandshake, describeTarget, type ExecTarget, scopeOf } from "~/lib/terminal/handshake";
import { OPEN_TABS_KEY, storedOpenTabs } from "~/lib/terminal/open-tabs";
import {
  createTerminal,
  disposeTerminal,
  freezeTerminal,
  safeFit,
  writeToTerminal,
} from "~/lib/terminal/xterm";

/** Sockets, kept out of state for the same reason terminals are. */
const sockets = new Map<string, ExecSocket>();

/** What each tab is connected to, so a retry can rebuild the same handshake. */
const targets = new Map<string, ExecTarget>();

/**
 * Which tabs were open, so a reload can ask for them back.
 *
 * This note stays in `localStorage` rather than moving to the settings file
 * with the dock's other state, because it is not a preference: it describes
 * what *this* window was doing a moment ago. The server only holds a session
 * for its grace window, so the note is worthless to another window and
 * worthless to a later launch. Its shape lives in `lib/terminal/open-tabs`,
 * where the reason it is parsed so carefully is written down.
 */
function rememberOpenTabs(): void {
  const entries = [...targets.entries()].map(([id, target]) => {
    const { title, subtitle } = describeTarget(target);
    return { id, target, kind: target.kind, title, subtitle };
  });
  writeStored(OPEN_TABS_KEY, JSON.stringify(entries));
}

interface SessionsStore extends SessionsState {
  readonly dockOpen: boolean;
  readonly fullscreen: boolean;
  /** True while a terminal's textarea actually has DOM focus. */
  readonly focused: boolean;

  open(target: ExecTarget): string;
  close(id: string): void;
  setActive(id: string): void;
  activateRelative(delta: number): void;
  toggleDock(open?: boolean): void;
  toggleFullscreen(): void;
  setFocused(focused: boolean): void;
  answerPrompt(id: string, response: ExecPromptResponse): void;
  /** Reconnects a tab to the same target, reusing the tab. */
  retry(id: string): void;
  /** Re-asks the server for the tabs that were open before a reload. */
  restore(): void;
  byId(id: string): TerminalSession | undefined;
}

export const useSessions = create<SessionsStore>((set, get) => {
  function patch(next: (state: SessionsState) => SessionsState): void {
    set((state) => ({ ...state, ...next(state) }));
  }

  function connect(id: string, target: ExecTarget, attach = false): void {
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
        record: settingsSnapshot().terminal.recordByDefault,
        ssmBash: settingsSnapshot().terminal.ssmBash,
        attach,
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

    // A handshake that never completes - the server is down, the origin is
    // wrong, the payload was rejected - otherwise leaves a tab connecting
    // forever with nothing to say. The socket does not retry by design, so
    // this is the end of the road rather than a transient state.
    socket.on("connect_error", (err: Error & { data?: { code?: string } }) => {
      patch((state) =>
        applyStatus(state, id, "errored", {
          error: {
            code: err.data?.code ?? "ConnectFailed",
            userMessage: `Could not reach the faws server: ${err.message}`,
          },
        }),
      );
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
    dockOpen: false,
    fullscreen: false,
    focused: false,

    open(target) {
      const id = crypto.randomUUID();
      const { title, subtitle } = describeTarget(target);
      targets.set(id, target);
      rememberOpenTabs();
      patch((state) =>
        addSession(state, {
          id,
          kind: target.kind,
          title,
          subtitle,
          scope: scopeOf(target),
          recordingPath: null,
          statusMessage: null,
        }),
      );
      set({ dockOpen: true });
      connect(id, target);
      return id;
    },

    /**
     * Picks up tabs that were open before a reload.
     *
     * Each asks the server to resume, and a session whose grace window lapsed
     * comes back as SessionGone - which lands the tab in the same exited state
     * a finished session does, with the same Restart button. Reopening is
     * never automatic: it would mean a reload silently starting shells on
     * hosts nobody asked to be on again.
     */
    restore() {
      if (get().sessions.length > 0) return;
      const remembered = readStored(OPEN_TABS_KEY, storedOpenTabs);
      if (remembered.length === 0) return;

      for (const entry of remembered) {
        const target = entry.target as ExecTarget;
        targets.set(entry.id, target);
        patch((state) =>
          addSession(state, {
            id: entry.id,
            kind: entry.kind,
            title: entry.title,
            subtitle: entry.subtitle,
            scope: scopeOf(target),
            recordingPath: null,
            statusMessage: "Picking this session back up...",
          }),
        );
        connect(entry.id, target, true);
      }
      set({ dockOpen: true });
    },

    close(id) {
      const socket = sockets.get(id);
      // Order matters: tell the server before dropping the socket, or the
      // driver only learns from the disconnect and the far end lingers.
      socket?.emit("exec:close");
      socket?.disconnect();
      sockets.delete(id);
      targets.delete(id);
      rememberOpenTabs();
      disposeTerminal(id);
      patch((state) => closeInModel(state, id));
      if (get().sessions.length === 0) set({ dockOpen: false, fullscreen: false });
    },

    setActive(id) {
      patch((state) => setActiveInModel(state, id));
    },

    activateRelative(delta) {
      const { activeId } = get();
      const sessions = displayOrder(get().sessions);
      if (sessions.length === 0) return;
      const index = sessions.findIndex((session) => session.id === activeId);
      const next = sessions[(index + delta + sessions.length) % sessions.length];
      if (next) patch((state) => setActiveInModel(state, next.id));
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

/** True while a terminal has focus, so page shortcuts can stand down. */
export function useTerminalFocused(): boolean {
  return useSessions((state) => state.focused);
}
