/**
 * Whether page-level shortcuts should stand down.
 *
 * Two independent reasons they should: an overlay is open, or a terminal has
 * focus. They are kept separate because they are not the same thing and the
 * terminal is emphatically *not* an overlay - an overlay is modal, stacked, and
 * closes on Escape, while the dock coexists with the page and Escape must reach
 * whatever is running inside it. Pushing the dock onto the overlay stack would
 * make `?` and Escape mean "close terminal", and would disable every page
 * shortcut whenever the dock was merely open, even with the cursor in a table.
 */
import { useOverlaysOpen } from "~/stores/overlays";
import { useTerminalFocused } from "~/stores/sessions";

export function useShortcutsSuspended(): boolean {
  const overlayOpen = useOverlaysOpen();
  const terminalFocused = useTerminalFocused();
  return overlayOpen || terminalFocused;
}
