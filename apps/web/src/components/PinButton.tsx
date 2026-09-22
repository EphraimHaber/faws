import { Pin, PinOff } from "lucide-react";

import { Button } from "~/components/ui/button";
import { recentActions, resourceKey, useIsPinned, type ResourceRef } from "~/stores/recents";

/**
 * Keeps a resource in the sidebar, or stops keeping it.
 *
 * Icon-only and ghost, because it sits beside a page's real actions and is not
 * one of them: pinning changes nothing about the thing being looked at. It is
 * never gated on write mode for the same reason - a pin is a note to yourself,
 * not a call against the account.
 */
export function PinButton({ target }: { target: ResourceRef }) {
  const pinned = useIsPinned(target);
  const Icon = pinned ? PinOff : Pin;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={pinned}
      title={pinned ? `Unpin ${target.label}` : `Pin ${target.label} to the sidebar`}
      aria-label={pinned ? `Unpin ${target.label}` : `Pin ${target.label}`}
      onClick={() =>
        pinned ? recentActions.unpin(resourceKey(target)) : recentActions.pin(target)
      }
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
    </Button>
  );
}
