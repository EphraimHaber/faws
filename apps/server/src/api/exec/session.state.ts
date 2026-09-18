/**
 * The lifecycle of one session, as a state machine rather than a pile of flags.
 *
 * Both reference implementations grew this organically - an `isClosing` here, a
 * `closeReason` there, four timer handles cancelled across three methods - and
 * the result was that "is this session still alive" had several answers that
 * could disagree. The bugs that produces are the worst kind: a shell that looks
 * closed and still holds a PTY, or a reconnect grace timer that fires after the
 * session it belonged to is gone.
 *
 * So: one `transition` is the only thing that changes state, and it is the only
 * thing that arms or clears a timer. Every timer belongs to exactly one state
 * and dies with it. `closed` is absorbing, which is what makes every teardown
 * path idempotent for free.
 *
 *     starting -> running -> detached -> running      (client came back)
 *                       \         \
 *                        \         -> closing -> closed
 *                         -> closing -> closed
 *
 * This module is deliberately free of sockets, AWS and timers-by-side-effect:
 * it takes a clock and a scheduler so the whole table can be tested in
 * milliseconds.
 */

export type SessionStateName = "starting" | "running" | "detached" | "closing" | "closed";

export interface SessionState {
  readonly name: SessionStateName;
  /** Why the session is closing or closed; null everywhere else. */
  readonly reason: string | null;
  /** Exit code, known only once a driver has actually exited. */
  readonly code: number | null;
}

/** Cancels a pending callback. Returned by the scheduler so state owns it. */
export type CancelTimer = () => void;

export interface SessionTimers {
  /** How long a connect may take before it is abandoned. */
  readonly connectMs: number;
  /** How long to hold a session whose socket dropped, waiting for a reattach. */
  readonly graceMs: number;
  /** Idle timeout, or 0 to never time out. Reset by client input only. */
  readonly idleMs: number;
}

export const DEFAULT_TIMERS: SessionTimers = {
  connectMs: 30_000,
  graceMs: 60_000,
  idleMs: 0,
};

export interface SessionMachineOptions {
  readonly timers: SessionTimers;
  /** Injected so tests do not wait in real time. */
  schedule(ms: number, fn: () => void): CancelTimer;
  /** Called after every accepted transition, for logging and side effects. */
  onEnter?(state: SessionState, previous: SessionState): void;
}

/** Which states may follow which. Anything absent is ignored, not thrown. */
const ALLOWED: Record<SessionStateName, ReadonlyArray<SessionStateName>> = {
  starting: ["running", "closing", "closed"],
  running: ["detached", "closing", "closed"],
  detached: ["running", "closing", "closed"],
  closing: ["closed"],
  closed: [],
};

export class SessionMachine {
  private current: SessionState = { name: "starting", reason: null, code: null };
  private cancelTimer: CancelTimer | null = null;
  private waitingForUser = false;
  private readonly options: SessionMachineOptions;

  constructor(options: SessionMachineOptions) {
    this.options = options;
    this.armFor(this.current);
  }

  get state(): SessionState {
    return this.current;
  }

  get isTerminal(): boolean {
    return this.current.name === "closed";
  }

  /**
   * Attempts a transition. Illegal edges are ignored rather than thrown,
   * because they are races, not bugs: a driver exiting at the same moment the
   * socket drops is ordinary, and the first one to arrive should win quietly.
   *
   * Returns whether the state actually changed.
   */
  transition(name: SessionStateName, detail?: { reason?: string; code?: number | null }): boolean {
    if (!ALLOWED[this.current.name].includes(name)) return false;

    const previous = this.current;
    this.clearTimer();
    this.current = {
      name,
      reason: detail?.reason ?? (name === "closing" || name === "closed" ? previous.reason : null),
      code: detail?.code ?? previous.code,
    };
    this.armFor(this.current);
    this.options.onEnter?.(this.current, previous);
    return true;
  }

  /**
   * Whether the session is blocked on a question only the person can answer.
   *
   * While it is, no timer runs. A connect timeout measures how long a host is
   * taking to answer, and it has no business counting the seconds someone
   * spends comparing a host-key fingerprint against another screen - which is
   * exactly the thing we want them to take their time over. The prompt has its
   * own, much longer, timeout.
   */
  setWaitingForUser(waiting: boolean): void {
    if (this.waitingForUser === waiting) return;
    this.waitingForUser = waiting;
    this.clearTimer();
    this.armFor(this.current);
  }

  /**
   * Client input arrived. Only this resets the idle timer - driver output must
   * not, or a chatty background process keeps a forgotten shell alive forever.
   */
  noteInput(): void {
    if (this.current.name !== "running") return;
    this.clearTimer();
    this.armFor(this.current);
  }

  /** Releases the pending timer without changing state, for final teardown. */
  dispose(): void {
    this.clearTimer();
  }

  private armFor(state: SessionState): void {
    if (this.waitingForUser) return;
    const { timers, schedule } = this.options;
    switch (state.name) {
      case "starting":
        this.cancelTimer = schedule(timers.connectMs, () => {
          this.transition("closing", { reason: "timed out while connecting" });
        });
        return;
      case "running":
        if (timers.idleMs <= 0) return;
        this.cancelTimer = schedule(timers.idleMs, () => {
          this.transition("closing", { reason: "idle" });
        });
        return;
      case "detached":
        this.cancelTimer = schedule(timers.graceMs, () => {
          this.transition("closing", { reason: "client did not come back" });
        });
        return;
      case "closing":
      case "closed":
        return;
    }
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
