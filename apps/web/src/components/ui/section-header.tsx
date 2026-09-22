import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A heading inside a scrolling column: the name, a rule running out to the
 * edge, and how many rows are under it.
 *
 * A rule rather than a border under the text, because these sections stack
 * directly on one another in the rail. A full-width divider under a heading
 * reads as the top of the next thing; one that starts after the word belongs
 * to the word.
 *
 * Deliberately not `PanelHeader`, which is a bordered bar with a fixed height
 * and its own padding - that is the top of a card, and this is a break in a
 * list. The two look different because they mean different things.
 */
export function SectionHeader({
  title,
  count,
  action,
  className,
}: {
  title: string;
  /** Left out entirely when a count would say nothing the rows do not. */
  count?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex shrink-0 items-center gap-2.5 border-t border-border pt-3.5", className)}
    >
      <span className="font-mono text-[9.5px] tracking-[0.26em] text-muted-foreground uppercase">
        {title}
      </span>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {count === undefined ? null : (
        <span className="font-mono text-[10px] text-muted-foreground/70 tabular">{count}</span>
      )}
      {action}
    </div>
  );
}
