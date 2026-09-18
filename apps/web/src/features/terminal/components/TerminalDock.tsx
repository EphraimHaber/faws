import { Maximize2, Minimize2, X } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { ResizeHandle } from "~/components/ui/resize-handle";
import { useTheme } from "~/contexts/ThemeContext";
import { applyTheme, focusTerminal } from "~/lib/terminal/xterm";
import { cn } from "~/lib/utils";
import { MIN_DOCK_HEIGHT, useSessions } from "~/stores/sessions";
import { SessionPane } from "./SessionPane";
import { TerminalTabs } from "./TerminalTabs";

/**
 * The terminal dock.
 *
 * Mounted once in RootLayout, as a sibling of the router's Outlet, because a
 * route component is unmounted on navigation and an xterm instance's entire
 * value - scrollback, cursor, an open vim, a half-typed command - lives in that
 * instance with no way to serialise and restore it. Navigating between pages
 * must not touch a running shell.
 *
 * The same reasoning is why every pane stays mounted and inactive ones are
 * hidden with `visibility` rather than unmounted or `display: none`.
 */
export function TerminalDock() {
  const sessions = useSessions((state) => state.sessions);
  const activeId = useSessions((state) => state.activeId);
  const height = useSessions((state) => state.height);
  const dockOpen = useSessions((state) => state.dockOpen);
  const fullscreen = useSessions((state) => state.fullscreen);
  const setHeight = useSessions((state) => state.setHeight);
  const setActive = useSessions((state) => state.setActive);
  const close = useSessions((state) => state.close);
  const toggleDock = useSessions((state) => state.toggleDock);
  const toggleFullscreen = useSessions((state) => state.toggleFullscreen);
  const { theme } = useTheme();

  React.useEffect(() => {
    // `theme` is the trigger rather than an input: applyTheme reads the live
    // computed palette, which is only correct once ThemeProvider has flipped
    // the class on the document.
    applyTheme();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [theme]);

  // Nothing re-fits the terminal here on purpose. Every way this dock can
  // change a pane's box - a drag, fullscreen, hiding the dock, the window
  // itself - changes the host element's size, and the ResizeObserver that
  // mountTerminal installs already watches that. An effect keyed on the dock's
  // own state would be a second, less reliable copy of the same rule.

  React.useEffect(() => {
    if (activeId && dockOpen) focusTerminal(activeId);
  }, [activeId, dockOpen]);

  // A live session is a remote process; leaving without a word would kill it.
  React.useEffect(() => {
    const live = sessions.some((session) => session.status === "ready");
    if (!live) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sessions]);

  if (sessions.length === 0 || !dockOpen) return null;

  return (
    <section
      aria-label="Terminals"
      className={cn(
        "flex shrink-0 flex-col border-t border-border bg-background",
        // Fullscreen is a CSS mode rather than the Fullscreen API, which would
        // take over the window chrome and steal Escape - which the terminal
        // needs. z-40 keeps the command palette and help overlay above it.
        fullscreen && "fixed inset-x-0 bottom-0 top-[var(--header-height,44px)] z-40",
      )}
      style={fullscreen ? undefined : { height }}
    >
      {!fullscreen ? (
        <ResizeHandle
          label="the terminal dock"
          orientation="horizontal"
          size={height}
          onResize={setHeight}
          min={MIN_DOCK_HEIGHT}
          // The dock is anchored to the bottom, so it grows as the pointer
          // moves up - the opposite of a column's trailing edge.
          direction={-1}
          className="relative -mt-1 h-2"
        />
      ) : null}

      <div className="flex items-stretch border-b border-border bg-muted/30">
        <TerminalTabs
          sessions={sessions}
          activeId={activeId}
          onSelect={setActive}
          onClose={close}
        />
        <div className="flex shrink-0 items-center gap-0.5 px-1.5">
          <Button
            variant="ghost"
            onClick={toggleFullscreen}
            title={fullscreen ? "Restore the dock" : "Fill the window"}
            aria-label={fullscreen ? "Restore the dock" : "Fill the window"}
          >
            {fullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          </Button>
          <Button
            variant="ghost"
            onClick={() => toggleDock(false)}
            title="Hide the dock (the sessions keep running)"
            aria-label="Hide the dock"
          >
            <X className="size-3" />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-card">
        {sessions.map((session) => (
          <SessionPane key={session.id} session={session} active={session.id === activeId} />
        ))}
      </div>
    </section>
  );
}
