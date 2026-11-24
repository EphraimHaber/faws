/**
 * The headless half of "refresh this widget".
 *
 * Every widget that shows fetched data offers a way to fetch it again and,
 * where there is room, says how old what it shows is. This hook owns the
 * behaviour - which queries, whether one is in flight, when they last
 * answered - and renders nothing, so a widget can use the stock parts in
 * `Refresh.tsx` or draw its own around the same state.
 */
import * as React from "react";

/** The part of a TanStack query result this needs; any `useQuery` result fits. */
export interface RefreshableQuery {
  refetch(): Promise<unknown>;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly dataUpdatedAt: number;
}

/** One query or several; a widget built from three queries refreshes all three. */
export type RefreshSource = RefreshableQuery | ReadonlyArray<RefreshableQuery>;

export interface RefreshState {
  /** Fetches every query again. Safe to call while one is already in flight. */
  refresh(): void;
  /** True while any of the queries is fetching, background refetches included. */
  readonly isRefreshing: boolean;
  /**
   * When the oldest of the queries last answered, or null before all of them
   * have. The oldest, because "updated 5s ago" over a panel half of which is
   * ten minutes stale would be a claim about the part nobody is looking at.
   */
  readonly updatedAt: number | null;
  /** True when the last attempt of any query failed. */
  readonly isError: boolean;
}

export function useRefreshable(source: RefreshSource): RefreshState {
  const queries: ReadonlyArray<RefreshableQuery> = isList(source) ? source : [source];

  const isRefreshing = queries.some((query) => query.isFetching);
  const isError = queries.some((query) => query.isError);
  const stamps = queries.map((query) => query.dataUpdatedAt);
  const updatedAt = stamps.length > 0 && stamps.every((at) => at > 0) ? Math.min(...stamps) : null;

  // The query objects change identity on every render; the refetch functions
  // are what a click needs, so it reads the latest through a ref instead of
  // making `refresh` a new function each render.
  const latest = React.useRef(queries);
  React.useLayoutEffect(() => {
    latest.current = queries;
  });
  const refresh = React.useCallback(() => {
    for (const query of latest.current) void query.refetch();
  }, []);

  return React.useMemo(
    () => ({ refresh, isRefreshing, updatedAt, isError }),
    [refresh, isRefreshing, updatedAt, isError],
  );
}

function isList(source: RefreshSource): source is ReadonlyArray<RefreshableQuery> {
  return Array.isArray(source);
}

/** "just now", "40s ago", "3m ago", "2h ago", "5d ago": short enough for a header. */
export function formatAge(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
