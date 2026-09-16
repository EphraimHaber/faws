import { useHotkeys } from "@tanstack/react-hotkeys";
import * as React from "react";

import { describe } from "~/lib/hotkeys";
import { useOverlaysOpen } from "~/stores/overlays";

/**
 * j/k (and arrow) row navigation with Enter to open — the muscle memory a TUI
 * user arrives with. Returns the active index plus a ref callback so the
 * active row can scroll itself into view.
 */
export function useListNavigation<T>(
  items: ReadonlyArray<T>,
  onOpen: (item: T, index: number) => void,
  enabled = true,
): {
  activeIndex: number;
  setActiveIndex(index: number): void;
  rowRef(index: number): (el: HTMLElement | null) => void;
} {
  const overlayOpen = useOverlaysOpen();
  const [requestedIndex, setActiveIndex] = React.useState(0);
  const rows = React.useRef(new Map<number, HTMLElement>());

  // The list shrinks under the cursor whenever a filter narrows it, so the
  // active row is clamped on read rather than corrected by an effect.
  const activeIndex = Math.min(requestedIndex, Math.max(0, items.length - 1));

  const move = React.useCallback(
    (delta: number) =>
      setActiveIndex((prev) =>
        Math.max(0, Math.min(items.length - 1, Math.min(prev, items.length - 1) + delta)),
      ),
    [items.length],
  );

  const open = React.useCallback(() => {
    const item = items[activeIndex];
    if (item !== undefined) onOpen(item, activeIndex);
  }, [items, activeIndex, onOpen]);

  useHotkeys(
    [
      {
        hotkey: "J",
        callback: () => move(1),
        options: { meta: describe("Navigation", "Next row") },
      },
      {
        hotkey: "ArrowDown",
        callback: () => move(1),
        options: { meta: describe("Navigation", "Next row") },
      },
      {
        hotkey: "K",
        callback: () => move(-1),
        options: { meta: describe("Navigation", "Previous row") },
      },
      {
        hotkey: "ArrowUp",
        callback: () => move(-1),
        options: { meta: describe("Navigation", "Previous row") },
      },
      {
        hotkey: "Enter",
        callback: open,
        options: { meta: describe("Navigation", "Drill into selection") },
      },
      { hotkey: "L", callback: open, options: { meta: describe("Navigation", "Drill in") } },
      { hotkey: "ArrowRight", callback: open },
      {
        hotkey: "G",
        callback: () => setActiveIndex(0),
        options: { meta: describe("Navigation", "First row") },
      },
      {
        hotkey: "Shift+G",
        callback: () => setActiveIndex(Math.max(0, items.length - 1)),
        options: { meta: describe("Navigation", "Last row") },
      },
    ],
    // Registrations stay in place while disabled so they remain visible in
    // devtools and the help overlay.
    { enabled: enabled && !overlayOpen, preventDefault: true },
  );

  React.useEffect(() => {
    rows.current.get(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const rowRef = React.useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (el) rows.current.set(index, el);
      else rows.current.delete(index);
    },
    [],
  );

  return { activeIndex, setActiveIndex, rowRef };
}
