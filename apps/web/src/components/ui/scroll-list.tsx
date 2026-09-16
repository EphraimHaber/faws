import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A capped-height list that reveals more as you reach the bottom.
 *
 * Panels on the overview hold whole-account inventories, which can be far
 * longer than the space available. Slicing to a fixed number and saying
 * nothing hides rows; rendering thousands at once costs a frame on every
 * refresh. This does neither: it renders a page at a time, grows when the
 * sentinel scrolls into view, and always states how many of how many are on
 * screen.
 *
 * The observer is rooted on the scroll container rather than the viewport,
 * because the sentinel lives inside an element with its own overflow and would
 * otherwise never intersect anything. That root is read from the sentinel's
 * own parent: React attaches child refs before parent ones, so a ref held on
 * the container is still null at the moment this runs.
 */
export function ScrollList<T>({
  items,
  renderItem,
  itemKey,
  pageSize = 25,
  className,
  emptyState,
  label,
}: {
  items: ReadonlyArray<T>;
  renderItem: (item: T) => React.ReactNode;
  itemKey: (item: T) => string;
  pageSize?: number;
  className?: string;
  emptyState?: React.ReactNode;
  /** Plural noun for the footer count, e.g. "clusters". */
  label: string;
}) {
  const [count, setCount] = React.useState(pageSize);

  // `count` only ever grows; slicing a shorter list is harmless, so filtering
  // needs no reset and no effect to keep the two in sync.
  const visible = items.slice(0, count);
  const hasMore = items.length > visible.length;

  const sentinelRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      const root = node?.parentElement;
      if (!node || !root) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setCount((current) => current + pageSize);
          }
        },
        // A margin means the next page is already there by the time the last
        // row is read, rather than arriving after a visible stop.
        { root, rootMargin: "200px" },
      );
      observer.observe(node);
      return () => observer.disconnect();
    },
    [pageSize],
  );

  if (items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-auto">
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((item) => (
            <React.Fragment key={itemKey(item)}>{renderItem(item)}</React.Fragment>
          ))}
        </ul>
        {hasMore ? <div ref={sentinelRef} className="h-px" aria-hidden /> : null}
      </div>

      <p className="shrink-0 border-t border-border px-4 py-1 font-mono text-[10px] text-muted-foreground">
        {hasMore ? `${visible.length} of ${items.length} ${label}` : `${items.length} ${label}`}
      </p>
    </div>
  );
}
