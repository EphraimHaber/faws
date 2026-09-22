import { Link } from "@tanstack/react-router";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * One thing in a list that is not a table.
 *
 * `DataTable` owns every list with columns worth lining up. What was left was
 * the other kind - endpoints, silenced warnings, remembered places, the rail's
 * clusters - each of which had grown its own arrangement of a leading mark, a
 * name, a second line in mono, and some controls on the right. They agreed on
 * all of that and disagreed on a pixel of padding here and a shade of muted
 * there, which is the sort of drift nobody sees in one file and everybody sees
 * across four.
 *
 * Two sizes, because there are two places this lives. A panel row can afford
 * two lines and room around them; the sidebar rail is a column of destinations
 * where the cost of a row is vertical space, so `dense` is a single line at
 * navigation padding.
 *
 * The leading slot takes a node rather than an icon type. It is a `StatusDot`
 * in the rail, a `Badge` naming the kind in Settings, and a lucide icon in the
 * remembered lists - one slot, because in every case it answers "what is this"
 * before the name does.
 */
export function EntityRow({
  icon,
  label,
  detail,
  badges,
  actions,
  to,
  onClick,
  active = false,
  dense = false,
  title,
  className,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** The second line, in mono: an address, a path, whatever disambiguates. */
  detail?: React.ReactNode;
  /** Sits beside the name, for what is true of the thing itself. */
  badges?: React.ReactNode;
  /**
   * The right-hand end: counts, a timestamp, buttons.
   *
   * Passed through untouched, so a caller that has to wrap a disabled control
   * in `DisabledHint` to keep its reason reachable can still do so.
   */
  actions?: React.ReactNode;
  to?: string;
  onClick?: () => void;
  /** Only meaningful on a row that leads somewhere. */
  active?: boolean;
  dense?: boolean;
  title?: string;
  className?: string;
}) {
  const interactive = to !== undefined || onClick !== undefined;

  const classes = cn(
    dense
      ? "flex items-center gap-2 rounded-md px-2 py-1.5"
      : "flex items-center gap-3 px-3.5 py-2",
    interactive &&
      cn(
        "transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
      ),
    className,
  );

  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[12.5px] text-foreground">{label}</span>
          {badges}
        </span>
        {detail === undefined ? null : (
          <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      {actions}
    </>
  );

  if (to !== undefined) {
    return (
      <Link to={to} title={title} className={classes}>
        {body}
      </Link>
    );
  }

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(classes, "w-full cursor-pointer text-left")}
      >
        {body}
      </button>
    );
  }

  return (
    <div title={title} className={classes}>
      {body}
    </div>
  );
}
