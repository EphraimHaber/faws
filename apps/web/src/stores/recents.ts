import {
  inScope,
  type RecentEntry,
  resourceKey,
  type ResourceRef,
  type ResourceScope,
} from "@faws/contracts";
import * as React from "react";

import { useScope } from "~/contexts/ScopeContext";
import { applyRecent, useSettings } from "./settings";

/**
 * What the app remembers about where you have been, and what you keep.
 *
 * Two lists with different jobs. **Recent** is automatic and decays: it is the
 * answer to "take me back to what I was doing", and it is worth nothing if it
 * has to be curated. **Pinned** is deliberate and permanent: the four things
 * you touch every day, which a recency list buries the moment you spend an
 * afternoon somewhere else.
 *
 * Both live in the server's settings file, so the bucket you pinned in the
 * browser is pinned in the desktop app, in the same order, without a reload.
 *
 * Scope is filtered **here, on read**, rather than at the point of writing.
 * Switching profile for an hour and switching back should not cost you the
 * list you built up - the other account's rows are still in the file, and they
 * come back with it. See `inScope` for why `connectionId` is only compared for
 * the S3 kinds.
 */
export type { RecentEntry, ResourceRef };
export { resourceKey };

interface RecentActions {
  record(ref: ResourceRef): void;
  pin(ref: ResourceRef): void;
  unpin(key: string): void;
  forget(key: string): void;
  forgetAll(target: "visited" | "pinned" | "both"): void;
}

export const recentActions: RecentActions = {
  record: (ref) => applyRecent({ op: "record", ref }),
  pin: (ref) => applyRecent({ op: "pin", ref }),
  unpin: (key) => applyRecent({ op: "unpin", key }),
  forget: (key) => applyRecent({ op: "forget", key }),
  forgetAll: (target) => applyRecent({ op: "forgetAll", target }),
};

/** The scope every list on screen is filtered against. */
function useResourceScope(): ResourceScope {
  const { profile, region, connectionId } = useScope();
  return React.useMemo(() => ({ profile, region, connectionId }), [profile, region, connectionId]);
}

function newestFirst(a: RecentEntry, b: RecentEntry): number {
  return b.at.localeCompare(a.at);
}

/**
 * Where you have been in this account, newest first.
 *
 * Pinned resources are left out rather than listed twice: a sidebar that shows
 * the same bucket under "Pinned" and again under "Recent" is spending two rows
 * on one destination, in the one column where rows are scarcest.
 */
export function useRecentList(limit?: number): RecentEntry[] {
  const visited = useSettings((state) => state.settings.recents.visited);
  const pinned = useSettings((state) => state.settings.recents.pinned);
  const scope = useResourceScope();

  return React.useMemo(() => {
    const rows = Object.entries(visited)
      .filter(([key, entry]) => !pinned[key] && inScope(entry, scope))
      .map(([, entry]) => entry)
      .toSorted(newestFirst);
    return limit === undefined ? rows : rows.slice(0, limit);
  }, [visited, pinned, scope, limit]);
}

/** What you have kept in this account, most recently pinned first. */
export function usePinnedList(limit?: number): RecentEntry[] {
  const pinned = useSettings((state) => state.settings.recents.pinned);
  const scope = useResourceScope();

  return React.useMemo(() => {
    const rows = Object.values(pinned)
      .filter((entry) => inScope(entry, scope))
      .toSorted(newestFirst);
    return limit === undefined ? rows : rows.slice(0, limit);
  }, [pinned, scope, limit]);
}

/** Everything remembered about this account, for the Settings panel. */
export function useRememberedList(): Array<{ entry: RecentEntry; key: string; pinned: boolean }> {
  const visited = useSettings((state) => state.settings.recents.visited);
  const pinned = useSettings((state) => state.settings.recents.pinned);
  const scope = useResourceScope();

  return React.useMemo(() => {
    const rows = [
      ...Object.entries(pinned).map(([key, entry]) => ({ key, entry, pinned: true })),
      ...Object.entries(visited)
        .filter(([key]) => !pinned[key])
        .map(([key, entry]) => ({ key, entry, pinned: false })),
    ];
    return rows
      .filter((row) => inScope(row.entry, scope))
      .toSorted((a, b) => newestFirst(a.entry, b.entry));
  }, [visited, pinned, scope]);
}

export function useIsPinned(ref: ResourceRef | null): boolean {
  const pinned = useSettings((state) => state.settings.recents.pinned);
  return ref ? Boolean(pinned[resourceKey(ref)]) : false;
}

/**
 * How long a page has to stay open before it counts as somewhere you went.
 *
 * Walking an S3 prefix tree is half a dozen navigations in as many seconds, and
 * without this every one of them would land in the list - so the list of where
 * you have been would be a list of the doors you passed through on the way.
 */
const DWELL_MS = 1000;

/**
 * Records a visit once the page has been looked at rather than passed through.
 *
 * Fires at most once per key per mount, so a component that re-renders while
 * the data loads - which is every page here - does not re-record on each pass.
 * `ref` is deliberately allowed to be null: pages call this before their query
 * has resolved the name they would record.
 */
export function useRecordVisit(ref: ResourceRef | null): void {
  const recorded = React.useRef<Set<string>>(new Set());
  const key = ref ? resourceKey(ref) : null;
  // Held in a ref so the timer below is armed by the key alone. The label and
  // the route can arrive a render or two after the id does, and restarting the
  // dwell every time they change would mean a page that is still loading never
  // finishes waiting.
  const latest = React.useRef(ref);
  React.useEffect(() => {
    latest.current = ref;
  });

  React.useEffect(() => {
    if (key === null || recorded.current.has(key)) return;
    const seen = recorded.current;
    const timer = setTimeout(() => {
      const current = latest.current;
      if (!current) return;
      seen.add(key);
      recentActions.record(current);
    }, DWELL_MS);
    return () => clearTimeout(timer);
  }, [key]);
}
