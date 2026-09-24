import {
  inScope,
  pinnedKeys,
  type RecentEntry,
  resourceKey,
  type ResourceRef,
  type ResourceScope,
} from "@faws/contracts";
import * as React from "react";

import { useScope } from "~/contexts/ScopeContext";
import { withScopedLink } from "~/features/kube/scope-link";
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
  /** Puts the pin `key` in the place of the pin `target`. */
  movePinned(key: string, target: string): void;
  forget(key: string): void;
  forgetAll(target: "visited" | "pinned" | "both"): void;
}

export const recentActions: RecentActions = {
  record: (ref) => applyRecent({ op: "record", ref }),
  pin: (ref) => applyRecent({ op: "pin", ref }),
  unpin: (key) => applyRecent({ op: "unpin", key }),
  movePinned: (key, target) => applyRecent({ op: "movePinned", key, target }),
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
      .map(([, entry]) => withScopedLink(entry))
      .toSorted(newestFirst);
    return limit === undefined ? rows : rows.slice(0, limit);
  }, [visited, pinned, scope, limit]);
}

/** What you have kept in this account, in the order the pins were arranged. */
export function usePinnedList(limit?: number): RecentEntry[] {
  const recents = useSettings((state) => state.settings.recents);
  const scope = useResourceScope();

  return React.useMemo(() => {
    const rows = pinnedKeys(recents)
      .map((key) => recents.pinned[key]!)
      .filter((entry) => inScope(entry, scope))
      .map(withScopedLink);
    return limit === undefined ? rows : rows.slice(0, limit);
  }, [recents, scope, limit]);
}

/**
 * Where each pin sits in the pinned order, keyed by `resourceKey`.
 *
 * Unscoped on purpose: a rank only has to compare pins that are both on
 * screen, and the gaps the other accounts' pins leave do not change which of
 * two comes first.
 */
export function usePinnedRanks(): ReadonlyMap<string, number> {
  const recents = useSettings((state) => state.settings.recents);
  return React.useMemo(
    () => new Map(pinnedKeys(recents).map((key, index) => [key, index])),
    [recents],
  );
}

/**
 * `rows` with the pinned ones first, in the pinned order, and the rest after
 * them in the order they came.
 *
 * Applied on top of whatever sort a list already has rather than instead of
 * it: the pins are the rows someone said they want every time, and the rest
 * are still worth finding the usual way.
 */
export function pinnedFirst<T>(
  rows: ReadonlyArray<T>,
  ranks: ReadonlyMap<string, number>,
  toRef: (row: T) => ResourceRef | null,
): T[] {
  if (ranks.size === 0) return [...rows];
  return rows
    .map((row, index) => {
      const ref = toRef(row);
      const rank = ref ? ranks.get(resourceKey(ref)) : undefined;
      return { row, index, rank: rank ?? ranks.size + index };
    })
    .toSorted((a, b) => a.rank - b.rank)
    .map((entry) => entry.row);
}

/** The drag payload type for a pin, so a stray link or text drag is not a move. */
export const PIN_DRAG_TYPE = "application/x-faws-pin";

/**
 * The pin being dragged, if any.
 *
 * Module state rather than component state, because the list a pin is picked
 * up from and the list it is dropped on need not be the same component, and a
 * drop target has to know during `dragover` - when the payload is still
 * unreadable - which way the pin is travelling to show where it will land.
 */
let dragging: string | null = null;

/** Which edge of a row a dragged pin would land against. */
export type PinDropEdge = "before" | "after";

/**
 * Drag and drop between pinned rows, for any list that shows them.
 *
 * Returns the props for one row. A pinned row can be picked up and dropped on;
 * any other row gets nothing, so an unpinned row keeps its text selectable and
 * its links draggable as they were. `data-pin-drop` names the edge the dragged
 * pin would land against, for the row to draw a line on.
 */
export function usePinDrag() {
  const ranks = usePinnedRanks();
  const [over, setOver] = React.useState<{ key: string; edge: PinDropEdge } | null>(null);

  return React.useCallback(
    (ref: ResourceRef | null) => {
      const key = ref ? resourceKey(ref) : null;
      const rank = key === null ? undefined : ranks.get(key);
      if (key === null || rank === undefined) return {};
      return {
        draggable: true,
        "data-pin-drop": over?.key === key ? over.edge : undefined,
        onDragStart: (event: React.DragEvent) => {
          // A pinned row may hold a link, whose own drag would otherwise
          // start in its place - and be dropped on the address bar.
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(PIN_DRAG_TYPE, key);
          dragging = key;
        },
        onDragEnd: () => {
          dragging = null;
          setOver(null);
        },
        onDragOver: (event: React.DragEvent) => {
          if (!event.dataTransfer.types.includes(PIN_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const from = dragging === null ? undefined : ranks.get(dragging);
          if (dragging === key || from === undefined) return setOver(null);
          const edge = from < rank ? "after" : "before";
          if (over?.key !== key || over.edge !== edge) setOver({ key, edge });
        },
        onDragLeave: () => setOver(null),
        onDrop: (event: React.DragEvent) => {
          if (!event.dataTransfer.types.includes(PIN_DRAG_TYPE)) return;
          event.preventDefault();
          event.stopPropagation();
          setOver(null);
          const moved = event.dataTransfer.getData(PIN_DRAG_TYPE);
          if (moved && moved !== key) recentActions.movePinned(moved, key);
        },
      };
    },
    [ranks, over],
  );
}

/**
 * The line a row draws where a dragged pin would land, keyed off the
 * `data-pin-drop` that `usePinDrag` sets. For a row whose own box can carry a
 * shadow; a table row draws it on its cells instead.
 */
export const PIN_DROP_CLASS =
  "data-[pin-drop=before]:shadow-[inset_0_2px_0_var(--primary)] data-[pin-drop=after]:shadow-[inset_0_-2px_0_var(--primary)]";

/** Everything remembered about this account, for the Settings panel. */
export function useRememberedList(): Array<{ entry: RecentEntry; key: string; pinned: boolean }> {
  const visited = useSettings((state) => state.settings.recents.visited);
  const pinned = useSettings((state) => state.settings.recents.pinned);
  const scope = useResourceScope();

  return React.useMemo(() => {
    const rows = [
      ...Object.entries(pinned).map(([key, entry]) => ({
        key,
        entry: withScopedLink(entry),
        pinned: true,
      })),
      ...Object.entries(visited)
        .filter(([key]) => !pinned[key])
        .map(([key, entry]) => ({ key, entry: withScopedLink(entry), pinned: false })),
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
