/**
 * Tab bookkeeping for the terminal dock, as plain data.
 *
 * Split out from the zustand store so the parts with actual rules - which tab
 * becomes active when you close one, which status changes are legal - can be
 * tested without a browser, a socket or a terminal.
 *
 * Nothing here holds a socket, an xterm instance or a secret. Those live in a
 * module-level map in the store, which is what keeps them out of devtools, out
 * of anything serialisable, and out of this file's way.
 */
import { EXEC_KINDS, type ExecErrorCode, type ExecKind, type ExecPrompt } from "@faws/contracts";

export type SessionStatus =
  | "connecting"
  /** Blocked on a question only the person can answer. */
  | "awaiting-prompt"
  | "ready"
  | "exited"
  | "errored";

export interface TerminalSession {
  readonly id: string;
  readonly kind: ExecKind;
  /** Short label for the tab: a container name, an instance id, a host. */
  readonly title: string;
  /** The scope or address, shown under the title so two tabs can be told apart. */
  readonly subtitle: string;
  /**
   * The environment alone - a cluster, an account and region, a host, a
   * context and namespace - which is what tabs of one kind are ordered by.
   */
  readonly scope: string;
  readonly status: SessionStatus;
  readonly error: { code: ExecErrorCode | string; userMessage: string } | null;
  readonly exit: { code: number | null; reason: string | null } | null;
  readonly prompt: ExecPrompt | null;
  readonly recordingPath: string | null;
  /** Last connect-progress line, shown while a slow transport comes up. */
  readonly statusMessage: string | null;
  readonly createdAt: number;
  /** Output arrived while this tab was not the active one. */
  readonly unread: boolean;
}

export interface SessionsState {
  readonly sessions: ReadonlyArray<TerminalSession>;
  readonly activeId: string | null;
}

export const EMPTY_SESSIONS: SessionsState = { sessions: [], activeId: null };

/** A session that has stopped: no input will reach anything. */
export function isFinished(session: TerminalSession): boolean {
  return session.status === "exited" || session.status === "errored";
}

export function addSession(
  state: SessionsState,
  session: Omit<TerminalSession, "status" | "error" | "exit" | "prompt" | "unread" | "createdAt"> &
    Partial<Pick<TerminalSession, "createdAt">>,
): SessionsState {
  const created: TerminalSession = {
    status: "connecting",
    error: null,
    exit: null,
    prompt: null,
    unread: false,
    createdAt: session.createdAt ?? Date.now(),
    ...session,
  };
  return {
    sessions: [...state.sessions, created],
    activeId: created.id,
  };
}

function update(
  state: SessionsState,
  id: string,
  patch: (session: TerminalSession) => TerminalSession,
): SessionsState {
  let changed = false;
  const sessions = state.sessions.map((session) => {
    if (session.id !== id) return session;
    const next = patch(session);
    if (next !== session) changed = true;
    return next;
  });
  return changed ? { ...state, sessions } : state;
}

/**
 * Which status changes are allowed.
 *
 * A finished session never goes back to running. Without this a late
 * `exec:data` or a racing `exec:ready` can resurrect a tab whose shell is gone,
 * leaving a terminal that accepts typing nothing will ever read.
 */
const ALLOWED: Record<SessionStatus, ReadonlyArray<SessionStatus>> = {
  connecting: ["awaiting-prompt", "ready", "exited", "errored"],
  "awaiting-prompt": ["connecting", "ready", "exited", "errored"],
  ready: ["awaiting-prompt", "exited", "errored"],
  exited: [],
  errored: [],
};

export function applyStatus(
  state: SessionsState,
  id: string,
  status: SessionStatus,
  detail?: Partial<Pick<TerminalSession, "error" | "exit" | "prompt" | "statusMessage">>,
): SessionsState {
  return update(state, id, (session) => {
    if (session.status === status && !detail) return session;
    // A self-transition carrying detail is an update, not a transition: it is
    // how connect progress reaches a tab that is still connecting. Sending it
    // through the edge table would drop it, and a slow transport would sit
    // behind a blank pane with nothing to say for itself.
    const isSelfUpdate = session.status === status;
    if (!isSelfUpdate && !ALLOWED[session.status].includes(status)) return session;
    return {
      ...session,
      status,
      // A prompt is cleared by moving off awaiting-prompt unless a new one came
      // with the change, so an answered question cannot linger on screen.
      prompt: detail?.prompt ?? (status === "awaiting-prompt" ? session.prompt : null),
      ...(detail?.error === undefined ? {} : { error: detail.error }),
      ...(detail?.exit === undefined ? {} : { exit: detail.exit }),
      ...(detail?.statusMessage === undefined ? {} : { statusMessage: detail.statusMessage }),
    };
  });
}

export function setRecordingPath(
  state: SessionsState,
  id: string,
  recordingPath: string | null,
): SessionsState {
  return update(state, id, (session) => ({ ...session, recordingPath }));
}

export function markUnread(state: SessionsState, id: string): SessionsState {
  if (state.activeId === id) return state;
  return update(state, id, (session) => (session.unread ? session : { ...session, unread: true }));
}

export function setActive(state: SessionsState, id: string): SessionsState {
  if (!state.sessions.some((session) => session.id === id)) return state;
  return {
    activeId: id,
    sessions: state.sessions.map((session) =>
      session.id === id && session.unread ? { ...session, unread: false } : session,
    ),
  };
}

/**
 * Which tab to activate after closing one.
 *
 * The right neighbour, falling back to the left - what every tabbed interface
 * does, and the reason is that closing a run of tabs from the middle should
 * keep the cursor moving in one direction instead of jumping to an end.
 */
export function nextActiveAfterClose(
  sessions: ReadonlyArray<TerminalSession>,
  closingId: string,
  activeId: string | null,
): string | null {
  if (activeId !== closingId) return activeId;
  const index = sessions.findIndex((session) => session.id === closingId);
  if (index < 0) return activeId;
  return sessions[index + 1]?.id ?? sessions[index - 1]?.id ?? null;
}

export function closeSession(state: SessionsState, id: string): SessionsState {
  if (!state.sessions.some((session) => session.id === id)) return state;
  return {
    activeId: nextActiveAfterClose(displayOrder(state.sessions), id, state.activeId),
    sessions: state.sessions.filter((session) => session.id !== id),
  };
}

export interface SessionGroup {
  readonly kind: ExecKind;
  readonly sessions: ReadonlyArray<TerminalSession>;
}

/**
 * The tabs as the dock draws them: one group per kind, in a fixed order.
 *
 * Kind rather than scope as the outer level, because there are at most four
 * kinds and a group per SSH host would be a row of one-tab groups. Scope is
 * the order inside a group, so two shells on the same cluster sit side by
 * side; ties keep the order they were opened in.
 */
export function groupSessions(sessions: ReadonlyArray<TerminalSession>): SessionGroup[] {
  return EXEC_KINDS.map((kind) => ({
    kind,
    sessions: sessions
      .filter((session) => session.kind === kind)
      .toSorted((a, b) => a.scope.localeCompare(b.scope) || a.createdAt - b.createdAt),
  })).filter((group) => group.sessions.length > 0);
}

/**
 * Every tab in the order it appears on screen.
 *
 * Closing a tab and cycling through them walk this rather than the order the
 * tabs were opened in; otherwise the tab that becomes active is not the one
 * beside the one that closed.
 */
export function displayOrder(sessions: ReadonlyArray<TerminalSession>): TerminalSession[] {
  return groupSessions(sessions).flatMap((group) => group.sessions);
}

/** What a group of sessions is called, in the dock and on the Sessions page. */
export const KIND_LABELS: Record<ExecKind, string> = {
  ecs: "ECS",
  ssm: "SSM",
  ssh: "SSH",
  kube: "Kube",
};

/** The colour of a session's status dot, wherever one is drawn. */
export function statusTone(session: TerminalSession): "success" | "warning" | "danger" | "neutral" {
  switch (session.status) {
    case "ready":
      return "success";
    case "connecting":
    case "awaiting-prompt":
      return "warning";
    case "errored":
      return "danger";
    case "exited":
      return "neutral";
  }
}

/** What a session is doing, in the words a list of them shows. */
export function describeStatus(session: TerminalSession): string {
  switch (session.status) {
    case "connecting":
      return "connecting";
    case "awaiting-prompt":
      return "waiting for you";
    case "ready":
      return "open";
    case "exited":
      return session.exit?.code === null || session.exit?.code === undefined
        ? "exited"
        : `exited (${session.exit.code})`;
    case "errored":
      return session.error ? `failed: ${session.error.userMessage}` : "failed";
  }
}
