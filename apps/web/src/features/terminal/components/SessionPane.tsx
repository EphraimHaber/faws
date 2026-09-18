import { RotateCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { TerminalSession } from "~/lib/terminal/sessions-model";
import { useSessions } from "~/stores/sessions";
import { TerminalSurface } from "./TerminalSurface";

/**
 * One tab's contents: the terminal, plus whatever the session needs to say.
 *
 * Errors and exits are rendered *below* the terminal rather than replacing it.
 * An error after two hundred lines of output is usually explained by those
 * lines, and throwing them away to show a red box is the most common way a tool
 * makes a failure harder to understand than it needed to be.
 */
export function SessionPane({ session, active }: { session: TerminalSession; active: boolean }) {
  const retry = useSessions((state) => state.retry);
  const close = useSessions((state) => state.close);

  return (
    <div
      // Hidden panes keep their layout box: `display: none` measures 0x0, which
      // makes the fit addon propose nonsense and silences the ResizeObserver
      // that would otherwise recover when the tab comes back.
      className={cn("absolute inset-0 flex flex-col", !active && "invisible")}
      aria-hidden={!active}
    >
      {session.status === "connecting" && session.statusMessage ? (
        <div className="shrink-0 border-b border-border/60 px-3 py-1 font-mono text-[11px] text-muted-foreground">
          {session.statusMessage}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 p-1.5">
        <TerminalSurface sessionId={session.id} active={active} />
      </div>

      {session.status === "errored" && session.error ? (
        <div className="shrink-0 border-t border-danger/40 bg-danger/5 px-3 py-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] font-medium text-danger">{session.error.code}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-foreground/90">
                {session.error.userMessage}
              </p>
            </div>
            <Button onClick={() => retry(session.id)} title="Connect again">
              <RotateCw className="size-3" /> Retry
            </Button>
          </div>
        </div>
      ) : null}

      {session.status === "exited" && session.exit ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          <span>
            exited
            {session.exit.code === null ? "" : ` (code ${session.exit.code})`}
            {session.exit.reason ? ` - ${session.exit.reason}` : ""}
          </span>
          <Button className="ml-auto" variant="ghost" onClick={() => retry(session.id)}>
            <RotateCw className="size-3" /> Restart
          </Button>
          <Button variant="ghost" onClick={() => close(session.id)}>
            Close
          </Button>
        </div>
      ) : null}
    </div>
  );
}
