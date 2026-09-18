import * as React from "react";

import { useSessions } from "~/stores/sessions";
import { mountTerminal, setRendererActive } from "~/lib/terminal/xterm";

/**
 * One terminal, attached to one div.
 *
 * The single `sessionId` prop is the whole design: a component whose only prop
 * is a stable string cannot be told to rebuild, so the terminal it hosts
 * survives every re-render of everything around it. Theme, focus and sizing are
 * applied imperatively from effects rather than flowing down as props, for the
 * same reason.
 */
export function TerminalSurface({ sessionId, active }: { sessionId: string; active: boolean }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const setFocused = useSessions((state) => state.setFocused);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    mountTerminal(sessionId, host, setFocused);
  }, [sessionId, setFocused]);

  // Only the pane in front gets a WebGL context; see lib/terminal/xterm.
  React.useEffect(() => {
    setRendererActive(sessionId, active);
  }, [sessionId, active]);

  return <div ref={hostRef} className="h-full w-full" />;
}
