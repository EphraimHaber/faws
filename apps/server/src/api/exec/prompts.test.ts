import type { ExecPrompt } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { PromptBroker, PromptRefusedError } from "./prompts.ts";
import type { CancelTimer } from "./session.state.ts";

function fakeClock() {
  let next = 1;
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
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

function hostKeyPrompt(promptId = "p1"): ExecPrompt {
  return {
    kind: "hostkey",
    promptId,
    host: "box.internal",
    port: 22,
    keyType: "ssh-ed25519",
    fingerprintSha256: "SHA256:abc",
    knownHostsLine: "box.internal ssh-ed25519 AAAA",
  };
}

function broker(options: { deliver?: () => boolean; timeoutMs?: number } = {}) {
  const clock = fakeClock();
  const delivered: ExecPrompt[] = [];
  const b = new PromptBroker({
    deliver: (prompt) => {
      delivered.push(prompt);
      return options.deliver ? options.deliver() : true;
    },
    schedule: clock.schedule,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return { b, clock, delivered };
}

describe("asking", () => {
  it("delivers the prompt and resolves with the answer", async () => {
    const { b, delivered } = broker();
    const pending = b.ask(hostKeyPrompt());
    expect(delivered).toHaveLength(1);

    b.answer({ promptId: "p1", trust: "permanent", cancelled: false });
    await expect(pending).resolves.toMatchObject({ trust: "permanent" });
    expect(b.pendingCount).toBe(0);
  });

  it("refuses a duplicate prompt id", async () => {
    const { b } = broker();
    const first = b.ask(hostKeyPrompt());
    await expect(b.ask(hostKeyPrompt())).rejects.toBeInstanceOf(PromptRefusedError);
    b.answer({ promptId: "p1", trust: "once", cancelled: false });
    await expect(first).resolves.toBeDefined();
  });

  it("ignores an answer to a prompt nobody asked", () => {
    const { b } = broker();
    expect(() => b.answer({ promptId: "nope", cancelled: false })).not.toThrow();
  });

  it("ignores a second answer to the same prompt", async () => {
    const { b } = broker();
    const pending = b.ask(hostKeyPrompt());
    b.answer({ promptId: "p1", trust: "once", cancelled: false });
    await expect(pending).resolves.toMatchObject({ trust: "once" });
    expect(() => b.answer({ promptId: "p1", trust: "permanent", cancelled: false })).not.toThrow();
  });
});

describe("silence is never consent", () => {
  it("refuses on an explicit cancel", async () => {
    const { b } = broker();
    const pending = b.ask(hostKeyPrompt());
    b.answer({ promptId: "p1", cancelled: true });
    await expect(pending).rejects.toBeInstanceOf(PromptRefusedError);
  });

  it("refuses on timeout", async () => {
    const { b, clock } = broker({ timeoutMs: 1000 });
    const pending = b.ask(hostKeyPrompt());
    clock.advance(1000);
    await expect(pending).rejects.toThrow(/timed out/i);
  });

  it("refuses when there is nobody to ask", async () => {
    const { b } = broker({ deliver: () => false });
    await expect(b.ask(hostKeyPrompt())).rejects.toThrow(/nobody is connected/i);
  });

  it("refuses everything outstanding when the client goes away", async () => {
    const { b } = broker();
    const one = b.ask(hostKeyPrompt("a"));
    const two = b.ask(hostKeyPrompt("b"));
    b.abandon("the tab closed");
    await expect(one).rejects.toThrow(/tab closed/);
    await expect(two).rejects.toThrow(/tab closed/);
    expect(b.pendingCount).toBe(0);
  });

  it("refuses anything asked after close", async () => {
    const { b } = broker();
    b.close("session ended");
    await expect(b.ask(hostKeyPrompt())).rejects.toThrow(/closing/i);
  });

  it("does not resolve a trust decision the user never made", async () => {
    const { b, clock } = broker({ timeoutMs: 100 });
    const pending = b.ask(hostKeyPrompt());
    clock.advance(100);
    // The distinction that matters: rejected, not resolved with some default.
    await expect(pending).rejects.toBeInstanceOf(PromptRefusedError);
  });
});

describe("timers", () => {
  it("clears the timeout once answered", async () => {
    const { b, clock } = broker({ timeoutMs: 1000 });
    const pending = b.ask(hostKeyPrompt());
    b.answer({ promptId: "p1", trust: "once", cancelled: false });
    await pending;
    expect(clock.pendingCount).toBe(0);
  });

  it("clears the timeout when abandoned", async () => {
    const { b, clock } = broker({ timeoutMs: 1000 });
    const pending = b.ask(hostKeyPrompt());
    b.abandon("gone");
    await expect(pending).rejects.toBeDefined();
    expect(clock.pendingCount).toBe(0);
  });
});
