/**
 * The stock parts for `useRefreshable`.
 *
 * `RefreshControl` is what nearly every widget wants and what `PanelHeader`
 * renders for its `refresh` prop. The parts are exported separately for a
 * widget that lays them out differently, and `Refreshable` hands the raw state
 * to a render function for one that draws its own.
 */
import { RefreshCw } from "lucide-react";
import type * as React from "react";

import { useClock } from "~/hooks/useClock";
import { cn } from "~/lib/utils";

import { formatAge, type RefreshSource, type RefreshState, useRefreshable } from "./useRefreshable";

export function RefreshButton({
  state,
  label = "Refresh",
  className,
}: {
  state: RefreshState;
  /** What is being refreshed, for the tooltip and screen readers. */
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={state.refresh}
      aria-label={label}
      title={label}
      aria-busy={state.isRefreshing}
      className={cn(
        "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        state.isError && "text-danger",
        className,
      )}
    >
      <RefreshCw
        className={cn("size-3.5", state.isRefreshing && "animate-spin")}
        strokeWidth={1.8}
        aria-hidden
      />
    </button>
  );
}

/**
 * "updated 3m ago", with the exact time on hover.
 *
 * Hidden by a container query when the header it sits in is narrow, so it is
 * the first thing to go rather than the title or the controls; the parent
 * declares the container (`PanelHeader` does).
 */
export function LastUpdated({ state, className }: { state: RefreshState; className?: string }) {
  const now = useClock();
  if (state.updatedAt === null) return null;
  return (
    <time
      dateTime={new Date(state.updatedAt).toISOString()}
      title={`Updated ${new Date(state.updatedAt).toLocaleString()}`}
      className={cn(
        "hidden font-mono text-[10px] whitespace-nowrap text-muted-foreground/70 tabular @md:inline",
        className,
      )}
    >
      {state.isRefreshing ? "refreshing…" : `updated ${formatAge(state.updatedAt, now)}`}
    </time>
  );
}

/** Last-updated and the button, side by side: the default for a widget header. */
export function RefreshControl({
  source,
  label,
  className,
}: {
  source: RefreshSource;
  label?: string;
  className?: string;
}) {
  const state = useRefreshable(source);
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <LastUpdated state={state} />
      <RefreshButton state={state} {...(label === undefined ? {} : { label })} />
    </span>
  );
}

/** Headless: the state, handed to whatever the widget wants to draw. */
export function Refreshable({
  source,
  children,
}: {
  source: RefreshSource;
  children: (state: RefreshState) => React.ReactNode;
}) {
  return children(useRefreshable(source));
}
