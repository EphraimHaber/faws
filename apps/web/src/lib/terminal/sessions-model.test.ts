import { describe, expect, it } from "vitest";

import {
  addSession,
  applyStatus,
  closeSession,
  displayOrder,
  EMPTY_SESSIONS,
  groupSessions,
  isFinished,
  markUnread,
  nextActiveAfterClose,
  setActive,
  type SessionsState,
  type TerminalSession,
} from "./sessions-model.ts";

function withTabs(...ids: string[]): SessionsState {
  return ids.reduce<SessionsState>(
    (state, id) =>
      addSession(state, {
        id,
        kind: "ssm",
        title: id,
        subtitle: "default / il-central-1",
        scope: "default / il-central-1",
        recordingPath: null,
        statusMessage: null,
      }),
    EMPTY_SESSIONS,
  );
}

describe("adding", () => {
  it("appends and activates the new tab", () => {
    const state = withTabs("a", "b");
    expect(state.sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("b");
  });

  it("starts connecting, with nothing to report yet", () => {
    const [session] = withTabs("a").sessions;
    expect(session?.status).toBe("connecting");
    expect(session?.error).toBe(null);
    expect(session?.exit).toBe(null);
    expect(session?.unread).toBe(false);
  });
});

describe("status", () => {
  it("walks connecting to ready to exited", () => {
    let state = withTabs("a");
    state = applyStatus(state, "a", "ready");
    expect(state.sessions[0]?.status).toBe("ready");
    state = applyStatus(state, "a", "exited", { exit: { code: 0, reason: null } });
    expect(state.sessions[0]?.status).toBe("exited");
    expect(state.sessions[0]?.exit).toEqual({ code: 0, reason: null });
  });

  it("refuses to resurrect a finished session", () => {
    let state = applyStatus(withTabs("a"), "a", "exited", { exit: { code: 1, reason: null } });
    state = applyStatus(state, "a", "ready");
    expect(state.sessions[0]?.status).toBe("exited");
  });

  it("refuses to resurrect an errored session", () => {
    let state = applyStatus(withTabs("a"), "a", "errored", {
      error: { code: "TargetNotConnected", userMessage: "nope" },
    });
    state = applyStatus(state, "a", "ready");
    expect(state.sessions[0]?.status).toBe("errored");
    expect(state.sessions[0]?.error?.code).toBe("TargetNotConnected");
  });

  it("clears a prompt once the session moves on", () => {
    const prompt = {
      kind: "hostkey" as const,
      promptId: "p1",
      host: "h",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprintSha256: "SHA256:x",
      knownHostsLine: "h ssh-ed25519 AAAA",
    };
    let state = applyStatus(withTabs("a"), "a", "awaiting-prompt", { prompt });
    expect(state.sessions[0]?.prompt).toEqual(prompt);
    state = applyStatus(state, "a", "ready");
    expect(state.sessions[0]?.prompt).toBe(null);
  });

  it("carries connect progress while still connecting", () => {
    // A self-transition with detail is an update, not a transition. Without
    // this, a slow transport shows a blank pane and looks like a hang.
    const state = applyStatus(withTabs("a"), "a", "connecting", {
      statusMessage: "Opening an SSM tunnel...",
    });
    expect(state.sessions[0]?.statusMessage).toBe("Opening an SSM tunnel...");
    expect(state.sessions[0]?.status).toBe("connecting");
  });

  it("still refuses a self-update on a finished session", () => {
    let state = applyStatus(withTabs("a"), "a", "exited", { exit: { code: 0, reason: null } });
    state = applyStatus(state, "a", "exited", { statusMessage: "late" });
    // Same status, so the update lands, but nothing may revive it.
    expect(state.sessions[0]?.status).toBe("exited");
  });

  it("ignores a status change for an unknown id", () => {
    const state = withTabs("a");
    expect(applyStatus(state, "nope", "ready")).toBe(state);
  });

  it("knows which sessions are finished", () => {
    const state = applyStatus(withTabs("a"), "a", "exited", { exit: { code: 0, reason: null } });
    expect(isFinished(state.sessions[0]!)).toBe(true);
  });
});

describe("unread", () => {
  it("marks a background tab unread", () => {
    const state = markUnread(withTabs("a", "b"), "a");
    expect(state.sessions[0]?.unread).toBe(true);
  });

  it("never marks the active tab unread", () => {
    const state = markUnread(withTabs("a", "b"), "b");
    expect(state.sessions[1]?.unread).toBe(false);
  });

  it("clears unread when the tab is activated", () => {
    let state = markUnread(withTabs("a", "b"), "a");
    state = setActive(state, "a");
    expect(state.sessions[0]?.unread).toBe(false);
    expect(state.activeId).toBe("a");
  });
});

describe("closing", () => {
  it("activates the right neighbour", () => {
    const state = closeSession(setActive(withTabs("a", "b", "c"), "b"), "b");
    expect(state.activeId).toBe("c");
    expect(state.sessions.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("falls back to the left when closing the last tab", () => {
    const state = closeSession(setActive(withTabs("a", "b", "c"), "c"), "c");
    expect(state.activeId).toBe("b");
  });

  it("clears the active id when closing the only tab", () => {
    const state = closeSession(withTabs("a"), "a");
    expect(state.activeId).toBe(null);
    expect(state.sessions).toEqual([]);
  });

  it("leaves the active tab alone when closing a different one", () => {
    const state = closeSession(setActive(withTabs("a", "b", "c"), "a"), "c");
    expect(state.activeId).toBe("a");
  });

  it("ignores an unknown id", () => {
    const state = withTabs("a");
    expect(closeSession(state, "nope")).toBe(state);
  });

  it("picks the same neighbour the reducer does", () => {
    const sessions = withTabs("a", "b", "c").sessions;
    expect(nextActiveAfterClose(sessions, "b", "b")).toBe("c");
    expect(nextActiveAfterClose(sessions, "c", "c")).toBe("b");
    expect(nextActiveAfterClose(sessions, "a", "c")).toBe("c");
  });
});

function tab(id: string, kind: TerminalSession["kind"], scope: string, createdAt: number) {
  return (state: SessionsState) =>
    addSession(state, {
      id,
      kind,
      title: id,
      subtitle: scope,
      scope,
      recordingPath: null,
      statusMessage: null,
      createdAt,
    });
}

/** Opened in an order that matches neither the grouping nor the scope order. */
const mixed = [
  tab("kube-web", "kube", "prod / web", 1),
  tab("ssm-1", "ssm", "default / il-central-1", 2),
  tab("ecs-api", "ecs", "payments", 3),
  tab("kube-api", "kube", "dev / api", 4),
  tab("ecs-worker", "ecs", "billing", 5),
  tab("kube-web-2", "kube", "prod / web", 6),
].reduce((state, add) => add(state), EMPTY_SESSIONS);

describe("grouping", () => {
  it("groups by kind in a fixed order, leaving out kinds with no tabs", () => {
    expect(
      groupSessions(mixed.sessions).map((group) => [group.kind, group.sessions.length]),
    ).toEqual([
      ["ecs", 2],
      ["ssm", 1],
      ["kube", 3],
    ]);
  });

  it("orders a group by scope, so shells on one environment sit together", () => {
    const kube = groupSessions(mixed.sessions).find((group) => group.kind === "kube");
    expect(kube?.sessions.map((s) => s.id)).toEqual(["kube-api", "kube-web", "kube-web-2"]);
  });

  it("lays the groups out end to end for everything that walks the tabs", () => {
    expect(displayOrder(mixed.sessions).map((s) => s.id)).toEqual([
      "ecs-worker",
      "ecs-api",
      "ssm-1",
      "kube-api",
      "kube-web",
      "kube-web-2",
    ]);
  });

  it("activates the neighbour on screen, not the one opened next", () => {
    // Opened after ssm-1, but on screen the tab to the right of ecs-api is ssm-1.
    const state = closeSession(setActive(mixed, "ecs-api"), "ecs-api");
    expect(state.activeId).toBe("ssm-1");
  });
});
