import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A draggable separator that reports a new size.
 *
 * It owns no size of its own: it reads `size` and calls `onResize`, so the
 * value can live wherever it belongs — an app-wide preference for the log
 * pane's columns, a store for the terminal dock's height — rather than in this
 * component's state, where two handles over one value would drift apart.
 *
 * `direction` exists because which way is "bigger" is not a property of the
 * axis. A column's trailing edge grows as the pointer moves right, while a dock
 * anchored to the bottom of the window grows as it moves up.
 *
 * The pointer listeners go on the handle itself under pointer capture rather
 * than on `window`, so a drag that leaves the element — or the window — still
 * tracks and still ends.
 */
export function ResizeHandle({
  label,
  /** Which way the handle itself runs, and therefore which axis it drags. */
  orientation,
  size,
  onResize,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  /** 1 when moving toward larger coordinates grows the thing, -1 when it shrinks it. */
  direction = 1,
  /** Inline positioning, since only the caller knows where its edge is. */
  style,
  className,
}: {
  label: string;
  orientation: "vertical" | "horizontal";
  size: number;
  onResize: (next: number) => void;
  min?: number;
  max?: number;
  direction?: 1 | -1;
  style?: React.CSSProperties;
  className?: string;
}) {
  const vertical = orientation === "vertical";
  const clamp = React.useCallback(
    (next: number) => Math.min(max, Math.max(min, Math.round(next))),
    [min, max],
  );

  // Arrow keys make this reachable without a pointer, which a mouse-only
  // control would not be in an app whose every other affordance has a binding.
  // These are element-local rather than registered with `useHotkeys` because a
  // separator's arrows should only move it while it has focus.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 16 : 1;
    const grow = vertical ? "ArrowRight" : "ArrowUp";
    const shrink = vertical ? "ArrowLeft" : "ArrowDown";

    if (event.key === grow) onResize(clamp(size + step * direction));
    else if (event.key === shrink) onResize(clamp(size - step * direction));
    else if (event.key === "Home") onResize(clamp(min));
    else if (event.key === "End" && Number.isFinite(max)) onResize(clamp(max));
    else return;

    event.preventDefault();
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={`Resize ${label}`}
      aria-valuenow={size}
      aria-valuemin={min}
      {...(Number.isFinite(max) ? { "aria-valuemax": max } : {})}
      title={`Drag to resize ${label}`}
      style={style}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.preventDefault();
        const start = vertical ? event.clientX : event.clientY;
        const from = size;
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);

        const move = (moveEvent: PointerEvent) => {
          const now = vertical ? moveEvent.clientX : moveEvent.clientY;
          onResize(clamp(from + (now - start) * direction));
        };
        const stop = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
      }}
      className={cn(
        // A hairline that only appears on hover or focus: visible when you
        // reach for it, invisible while you are reading past it.
        "z-10 touch-none after:absolute after:bg-transparent after:transition-colors hover:after:bg-primary/60 focus-visible:after:bg-primary focus-visible:outline-none",
        vertical
          ? "absolute inset-y-0 w-2 cursor-col-resize after:inset-y-0 after:left-[3px] after:w-px"
          : "absolute inset-x-0 h-2 cursor-row-resize after:inset-x-0 after:top-[3px] after:h-px",
        className,
      )}
    />
  );
}
