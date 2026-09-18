/**
 * Questions the server has to ask before it can continue.
 *
 * There is exactly one thing this has to get right: **silence is never
 * consent**. A prompt that times out, whose tab closed, or whose session went
 * away is a refusal. Both reference implementations skipped the roundtrip
 * entirely and trusted unknown host keys on sight, which is the failure this
 * module exists to prevent - so the default on every path that is not an
 * explicit answer is rejection.
 *
 * Kept separate from the socket so the drivers can `await ctx.ask(...)` without
 * knowing whether anyone is listening, and so the whole table of outcomes -
 * answered, cancelled, timed out, abandoned - is testable without a network.
 */
import type { ExecPrompt, ExecPromptResponse } from "@faws/contracts";

import type { CancelTimer } from "./session.state.ts";

/** Thrown for every non-answer, so a driver cannot mistake one for consent. */
export class PromptRefusedError extends Error {
  readonly promptId: string;

  constructor(promptId: string, message: string) {
    super(message);
    this.name = "PromptRefusedError";
    this.promptId = promptId;
  }
}

export interface PromptBrokerOptions {
  /** Delivers the question. Returns false when there is nobody to ask. */
  deliver(prompt: ExecPrompt): boolean;
  schedule(ms: number, fn: () => void): CancelTimer;
  /** How long a question may stand unanswered before it counts as refused. */
  timeoutMs?: number;
}

/**
 * Two minutes: long enough to read a fingerprint off another screen and compare
 * it, short enough that a forgotten prompt does not pin a session open.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

interface Outstanding {
  readonly resolve: (response: ExecPromptResponse) => void;
  readonly reject: (error: Error) => void;
  readonly cancelTimer: CancelTimer;
}

export class PromptBroker {
  private readonly outstanding = new Map<string, Outstanding>();
  private readonly options: PromptBrokerOptions;
  private readonly timeoutMs: number;
  private closed = false;

  constructor(options: PromptBrokerOptions) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get pendingCount(): number {
    return this.outstanding.size;
  }

  ask(prompt: ExecPrompt): Promise<ExecPromptResponse> {
    if (this.closed) {
      return Promise.reject(new PromptRefusedError(prompt.promptId, "The session is closing."));
    }
    if (this.outstanding.has(prompt.promptId)) {
      return Promise.reject(
        new PromptRefusedError(prompt.promptId, "That prompt is already outstanding."),
      );
    }

    return new Promise<ExecPromptResponse>((resolve, reject) => {
      const cancelTimer = this.options.schedule(this.timeoutMs, () => {
        this.settle(prompt.promptId, (entry) =>
          entry.reject(new PromptRefusedError(prompt.promptId, "Timed out waiting for an answer.")),
        );
      });

      this.outstanding.set(prompt.promptId, { resolve, reject, cancelTimer });

      // Delivered last: a synchronous failure to deliver must find the entry
      // already registered, or it would settle nothing and hang.
      if (!this.options.deliver(prompt)) {
        this.settle(prompt.promptId, (entry) =>
          entry.reject(new PromptRefusedError(prompt.promptId, "Nobody is connected to ask.")),
        );
      }
    });
  }

  /** An answer arrived. Unknown or duplicate ids are dropped silently. */
  answer(response: ExecPromptResponse): void {
    this.settle(response.promptId, (entry) => {
      if (response.cancelled) {
        entry.reject(new PromptRefusedError(response.promptId, "Cancelled."));
        return;
      }
      entry.resolve(response);
    });
  }

  /**
   * The client went away. Refuses everything outstanding immediately rather
   * than letting it ride to the timeout, because a driver blocked on a question
   * nobody can see is holding a connection open for nothing.
   */
  abandon(reason: string): void {
    for (const promptId of [...this.outstanding.keys()]) {
      this.settle(promptId, (entry) => entry.reject(new PromptRefusedError(promptId, reason)));
    }
  }

  /** Refuses everything outstanding and refuses anything asked afterwards. */
  close(reason: string): void {
    this.closed = true;
    this.abandon(reason);
  }

  private settle(promptId: string, finish: (entry: Outstanding) => void): void {
    const entry = this.outstanding.get(promptId);
    if (!entry) return;
    this.outstanding.delete(promptId);
    entry.cancelTimer();
    finish(entry);
  }
}
