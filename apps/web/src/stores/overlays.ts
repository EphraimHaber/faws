import * as React from "react";
import { create } from "zustand";

/**
 * Which overlays are open, as a stack.
 *
 * A keyboard-first app needs a notion of layers or its shortcuts leak: with a
 * dialog open, `j`/`k` still walk the table behind it, `h` navigates away from
 * the thing being edited, and `Escape` means two contradictory things at once.
 *
 * Every overlay pushes an entry while it is open. Page-level shortcuts are
 * registered with `enabled: !useOverlaysOpen()`, which soft-disables them —
 * the registrations stay visible in devtools and in the `?` overlay rather
 * than vanishing and reappearing.
 *
 * The stack, rather than a counter, is what lets `Escape` close only the
 * topmost overlay when several are open.
 */
interface OverlayState {
  readonly stack: ReadonlyArray<string>;
  push(id: string): void;
  pop(id: string): void;
}

const useOverlayStore = create<OverlayState>((set) => ({
  stack: [],
  push: (id) =>
    set((state) => (state.stack.includes(id) ? state : { stack: [...state.stack, id] })),
  pop: (id) => set((state) => ({ stack: state.stack.filter((entry) => entry !== id) })),
}));

/**
 * Declares an overlay open for as long as `open` is true.
 *
 * Returns whether this overlay is the topmost one, which is the condition its
 * own `Escape` handler should be enabled under.
 */
export function useOverlay(id: string, open: boolean): { isTop: boolean } {
  const push = useOverlayStore((state) => state.push);
  const pop = useOverlayStore((state) => state.pop);
  const stack = useOverlayStore((state) => state.stack);

  React.useEffect(() => {
    if (!open) return;
    push(id);
    return () => pop(id);
  }, [id, open, push, pop]);

  return { isTop: open && stack.at(-1) === id };
}

/** True while any overlay is open, so page shortcuts can stand down. */
export function useOverlaysOpen(): boolean {
  return useOverlayStore((state) => state.stack.length > 0);
}
