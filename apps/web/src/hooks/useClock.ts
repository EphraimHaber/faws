import * as React from "react";

/**
 * The current time, ticking on a shared interval.
 *
 * Every "updated 2m ago" on screen reads the same clock, so a page with
 * thirty panels runs one timer per step rather than thirty, and all thirty
 * labels change on the same frame instead of drifting apart.
 */
export function useClock(stepMs = 10_000): number {
  const clock = clockFor(stepMs);
  return React.useSyncExternalStore(clock.subscribe, clock.read, clock.read);
}

interface Clock {
  subscribe(listener: () => void): () => void;
  read(): number;
}

const clocks = new Map<number, Clock>();

function clockFor(stepMs: number): Clock {
  const existing = clocks.get(stepMs);
  if (existing) return existing;

  const listeners = new Set<() => void>();
  let now = Date.now();
  let timer: number | undefined;

  const clock: Clock = {
    subscribe(listener) {
      listeners.add(listener);
      if (timer === undefined) {
        now = Date.now();
        timer = window.setInterval(() => {
          now = Date.now();
          for (const notify of listeners) notify();
        }, stepMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
          window.clearInterval(timer);
          timer = undefined;
        }
      };
    },
    read: () => now,
  };
  clocks.set(stepMs, clock);
  return clock;
}
