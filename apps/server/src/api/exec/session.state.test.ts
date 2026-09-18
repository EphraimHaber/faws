import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMERS,
  SessionMachine,
  type CancelTimer,
  type SessionStateName,
} from "./session.state.ts";

/** A scheduler whose clock only moves when a test says so. */
function fakeClock() {
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let now = 0;

  return {
    get pendingCount() {
      return pending.size;
    },
    schedule(ms: number, fn: () => void): CancelTimer {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return () => pending.delete(id);
    },
    advance(ms: number) {
      now += ms;
      // Snapshotted: firing a timer deletes it from the map being iterated.
      for (const [id, timer] of Array.from(pending)) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
  };
}

function machine(overrides: Partial<typeof DEFAULT_TIMERS> = {}) {
  const clock = fakeClock();
  const seen: SessionStateName[] = [];
  const m = new SessionMachine({
    timers: { ...DEFAULT_TIMERS, ...overrides },
    schedule: clock.schedule,
    onEnter: (state) => seen.push(state.name),
  });
  return { m, clock, seen };
}

describe("transitions", () => {
  it("starts in starting", () => {
    const { m } = machine();
    expect(m.state.name).toBe("starting");
  });

  it("walks the happy path", () => {
    const { m, seen } = machine();
    expect(m.transition("running")).toBe(true);
    expect(m.transition("detached")).toBe(true);
    expect(m.transition("running")).toBe(true);
    expect(m.transition("closing", { reason: "bye" })).toBe(true);
    expect(m.transition("closed", { code: 0 })).toBe(true);
    expect(seen).toEqual(["running", "detached", "running", "closing", "closed"]);
  });

  it("ignores an illegal edge rather than throwing", () => {
    const { m } = machine();
    m.transition("running");
    m.transition("closed");
    expect(m.transition("running")).toBe(false);
    expect(m.state.name).toBe("closed");
  });

  it("cannot go back to running from closing", () => {
    const { m } = machine();
    m.transition("running");
    m.transition("closing");
    expect(m.transition("running")).toBe(false);
    expect(m.transition("detached")).toBe(false);
  });

  it("treats closed as absorbing, so teardown is idempotent", () => {
    const { m } = machine();
    m.transition("closed", { reason: "first", code: 3 });
    expect(m.transition("closed", { reason: "second" })).toBe(false);
    expect(m.state.reason).toBe("first");
    expect(m.state.code).toBe(3);
    expect(m.isTerminal).toBe(true);
  });

  it("carries the reason into closed when closing set one", () => {
    const { m } = machine();
    m.transition("running");
    m.transition("closing", { reason: "socket disconnected" });
    m.transition("closed");
    expect(m.state.reason).toBe("socket disconnected");
  });

  it("clears the reason on a non-terminal transition", () => {
    const { m } = machine();
    m.transition("running", { reason: "should not stick" });
    m.transition("detached");
    expect(m.state.reason).toBe(null);
  });
});

describe("timers", () => {
  it("abandons a connect that never completes", () => {
    const { m, clock } = machine({ connectMs: 1000 });
    clock.advance(999);
    expect(m.state.name).toBe("starting");
    clock.advance(1);
    expect(m.state.name).toBe("closing");
    expect(m.state.reason).toBe("timed out while connecting");
  });

  it("disarms the connect timer once running", () => {
    const { m, clock } = machine({ connectMs: 1000 });
    m.transition("running");
    clock.advance(5000);
    expect(m.state.name).toBe("running");
  });

  it("closes a detached session when the client does not come back", () => {
    const { m, clock } = machine({ graceMs: 500 });
    m.transition("running");
    m.transition("detached");
    clock.advance(500);
    expect(m.state.name).toBe("closing");
    expect(m.state.reason).toBe("client did not come back");
  });

  it("disarms the grace timer when the client reattaches", () => {
    const { m, clock } = machine({ graceMs: 500 });
    m.transition("running");
    m.transition("detached");
    clock.advance(499);
    m.transition("running");
    clock.advance(5000);
    expect(m.state.name).toBe("running");
  });

  it("never idles out when the idle timeout is off", () => {
    const { m, clock } = machine({ idleMs: 0 });
    m.transition("running");
    clock.advance(10_000_000);
    expect(m.state.name).toBe("running");
  });

  it("idles out when nothing is typed", () => {
    const { m, clock } = machine({ idleMs: 1000 });
    m.transition("running");
    clock.advance(1000);
    expect(m.state.name).toBe("closing");
    expect(m.state.reason).toBe("idle");
  });

  it("is kept alive by client input", () => {
    const { m, clock } = machine({ idleMs: 1000 });
    m.transition("running");
    clock.advance(900);
    m.noteInput();
    clock.advance(900);
    m.noteInput();
    clock.advance(900);
    expect(m.state.name).toBe("running");
  });

  it("ignores input outside running, so a closing session is not revived", () => {
    const { m, clock } = machine({ idleMs: 1000 });
    m.transition("running");
    m.transition("closing");
    m.noteInput();
    clock.advance(5000);
    expect(m.state.name).toBe("closing");
  });

  it("leaves no timer pending once closed", () => {
    const { m, clock } = machine({ connectMs: 1000, graceMs: 500, idleMs: 1000 });
    m.transition("running");
    m.transition("detached");
    m.transition("closed");
    expect(clock.pendingCount).toBe(0);
  });

  it("leaves no timer pending after dispose", () => {
    const { m, clock } = machine({ connectMs: 1000 });
    m.dispose();
    expect(clock.pendingCount).toBe(0);
  });

  it("holds exactly one timer at a time", () => {
    const { m, clock } = machine({ connectMs: 1000, graceMs: 500, idleMs: 1000 });
    expect(clock.pendingCount).toBe(1);
    m.transition("running");
    expect(clock.pendingCount).toBe(1);
    m.noteInput();
    expect(clock.pendingCount).toBe(1);
    m.transition("detached");
    expect(clock.pendingCount).toBe(1);
  });
});
