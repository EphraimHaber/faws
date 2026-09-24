import * as React from "react";

/**
 * The current time, refreshed only when the nearest of `deadlines` passes, so
 * anything shown "until" a moment disappears on time without a ticking clock.
 */
export function useNowUntil(deadlines: ReadonlyArray<number | null>): number {
  const [now, setNow] = React.useState(() => Date.now());
  const next = deadlines.reduce<number>(
    (soonest, deadline) =>
      deadline !== null && deadline > now ? Math.min(soonest, deadline) : soonest,
    Infinity,
  );

  React.useEffect(() => {
    if (!Number.isFinite(next)) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => window.clearTimeout(id);
  }, [next]);

  return now;
}
