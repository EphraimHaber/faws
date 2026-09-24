import { Pin, PinOff } from "lucide-react";

import type { Column } from "~/components/data-table";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { recentActions, resourceKey, useIsPinned, type ResourceRef } from "~/stores/recents";

/**
 * Keeps a resource in the sidebar, or stops keeping it.
 *
 * Icon-only and ghost, because it sits beside a page's real actions and is not
 * one of them: pinning changes nothing about the thing being looked at. It is
 * never gated on write mode for the same reason - a pin is a note to yourself,
 * not a call against the account.
 *
 * `quiet` is for rows: an unpinned row shows its pin only while hovered or
 * focused, so a list of forty reads as forty names, and the pinned ones stand out.
 */
export function PinButton({
  target,
  quiet = false,
  className,
}: {
  target: ResourceRef;
  quiet?: boolean;
  className?: string;
}) {
  const pinned = useIsPinned(target);
  // in a row the mark is a state to read at a glance, so it stays a pin, filled
  const Icon = pinned && !quiet ? PinOff : Pin;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={pinned}
      title={pinned ? `Unpin ${target.label}` : `Pin ${target.label} to the sidebar`}
      aria-label={pinned ? `Unpin ${target.label}` : `Pin ${target.label}`}
      onClick={(event) => {
        // rows open on click, and some rows are links
        event.preventDefault();
        event.stopPropagation();
        if (pinned) recentActions.unpin(resourceKey(target));
        else recentActions.pin(target);
      }}
      className={cn(
        quiet && "size-6 shrink-0",
        quiet &&
          !pinned &&
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100",
        quiet && pinned && "text-primary",
        className,
      )}
    >
      <Icon
        className="size-3.5"
        strokeWidth={1.8}
        fill={quiet && pinned ? "currentColor" : "none"}
      />
    </Button>
  );
}

/**
 * A table column holding each row's pin, kept in view at the right edge.
 *
 * It also tells the table what each row pins, which is what lists the pinned
 * rows first and lets them be dragged into order.
 */
export function pinColumn<T>(toRef: (row: T) => ResourceRef): Column<T> {
  return {
    pinTarget: toRef,
    id: "pin",
    header: "",
    width: "2.75rem",
    align: "right",
    pin: "end",
    value: () => "",
    cell: (row) => <PinButton quiet target={toRef(row)} />,
  };
}
