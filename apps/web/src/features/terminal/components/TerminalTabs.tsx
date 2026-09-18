import { Circle, Dot, X } from "lucide-react";

import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/utils";
import type { TerminalSession } from "~/lib/terminal/sessions-model";

function toneFor(session: TerminalSession): "success" | "warning" | "danger" | "neutral" {
  switch (session.status) {
    case "ready":
      return "success";
    case "connecting":
      return "warning";
    case "awaiting-prompt":
      return "warning";
    case "errored":
      return "danger";
    case "exited":
      return "neutral";
  }
}

/**
 * The tab strip.
 *
 * A tab shows its own kind and scope rather than just a name, because two tabs
 * open on the same container name in different clusters are otherwise
 * indistinguishable - and confusing which environment a shell is on is the
 * expensive mistake this whole feature can cause.
 */
export function TerminalTabs({
  sessions,
  activeId,
  onSelect,
  onClose,
}: {
  sessions: ReadonlyArray<TerminalSession>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
      {sessions.map((session) => {
        const isActive = session.id === activeId;
        return (
          <div
            key={session.id}
            className={cn(
              "group flex min-w-0 shrink-0 items-center gap-1.5 border-r border-border px-2.5 text-[11px]",
              isActive ? "bg-card text-foreground" : "text-muted-foreground hover:bg-card/50",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(session.id)}
              className="flex min-w-0 items-center gap-1.5 py-1.5"
              title={`${session.title} - ${session.subtitle}`}
            >
              <StatusDot tone={toneFor(session)} />
              <span className="truncate font-medium">{session.title}</span>
              <span className="truncate text-[10px] text-muted-foreground/70">{session.kind}</span>
              {session.unread && !isActive ? (
                <Dot className="size-3 text-primary" aria-label="new output" />
              ) : null}
              {session.recordingPath ? (
                <Circle className="size-2 fill-danger text-danger" aria-label="recording" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => onClose(session.id)}
              aria-label={`Close ${session.title}`}
              className="rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
