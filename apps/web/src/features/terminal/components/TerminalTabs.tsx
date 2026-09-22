import { Dot, X } from "lucide-react";

import * as React from "react";

import { StatusDot } from "~/components/ui/status-dot";
import {
  groupSessions,
  KIND_LABELS,
  statusTone,
  type TerminalSession,
} from "~/lib/terminal/sessions-model";
import { cn } from "~/lib/utils";

/**
 * The tab strip, one group per kind of session.
 *
 * Grouped so that an ECS exec, an SSM shell and a pod shell never sit
 * interleaved by the order they were opened in, and ordered by scope inside a
 * group so shells on one environment sit together. The scope is in each tab's
 * tooltip, because two tabs open on the same container name in different
 * clusters are otherwise indistinguishable - and confusing which environment a
 * shell is on is the expensive mistake this whole feature can cause.
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
      {groupSessions(sessions).map((group) => (
        <React.Fragment key={group.kind}>
          <span
            className="flex shrink-0 items-center gap-1.5 border-r border-border px-2 font-mono text-[9.5px] tracking-[0.2em] text-muted-foreground uppercase"
            aria-label={`${KIND_LABELS[group.kind]}, ${group.sessions.length} open`}
          >
            {KIND_LABELS[group.kind]}
            <span className="tracking-normal text-muted-foreground/70 tabular">
              {group.sessions.length}
            </span>
          </span>
          {group.sessions.map((session) => (
            <Tab
              key={session.id}
              session={session}
              active={session.id === activeId}
              onSelect={onSelect}
              onClose={onClose}
            />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function Tab({
  session,
  active: isActive,
  onSelect,
  onClose,
}: {
  session: TerminalSession;
  active: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div
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
        <StatusDot tone={statusTone(session)} />
        <span className="truncate font-medium">{session.title}</span>
        {session.unread && !isActive ? (
          <Dot className="size-3 text-primary" aria-label="new output" />
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
}
