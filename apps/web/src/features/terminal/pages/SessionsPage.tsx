import { TerminalSquare } from "lucide-react";

import { EntityRow } from "~/components/entity-row";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { SectionHeader } from "~/components/ui/section-header";
import { StatusDot } from "~/components/ui/status-dot";
import {
  describeStatus,
  groupSessions,
  isFinished,
  KIND_LABELS,
  statusTone,
} from "~/lib/terminal/sessions-model";
import { useSessions } from "~/stores/sessions";

/**
 * Every open session, grouped the way the dock groups its tabs.
 *
 * An index rather than a second place to type: the terminal itself stays in
 * the dock, and Focus brings its tab forward and opens the dock over whatever
 * page this is. What this page adds is the whole list at once, with each
 * session's environment and state written out, which a strip of tabs has no
 * room for.
 */
export function SessionsPage() {
  const sessions = useSessions((state) => state.sessions);
  const activeId = useSessions((state) => state.activeId);
  const dockOpen = useSessions((state) => state.dockOpen);
  const setActive = useSessions((state) => state.setActive);
  const toggleDock = useSessions((state) => state.toggleDock);
  const close = useSessions((state) => state.close);

  const focus = (id: string) => {
    setActive(id);
    toggleDock(true);
  };

  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader>
        <PanelTitle>Open sessions</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {sessions.length}
        </span>
      </PanelHeader>

      {sessions.length === 0 ? (
        <EmptyState
          icon={TerminalSquare}
          title="No sessions open"
          hint="Open one from an ECS task, an EC2 instance or a pod, or from the terminal button in the status bar."
        />
      ) : (
        <div className="flex min-h-0 flex-col overflow-auto pb-2">
          {groupSessions(sessions).map((group) => (
            <section key={group.kind}>
              <SectionHeader
                title={KIND_LABELS[group.kind]}
                count={group.sessions.length}
                className="mx-3.5 mt-2 mb-1"
              />
              <ul>
                {group.sessions.map((session) => (
                  <li key={session.id}>
                    <EntityRow
                      icon={<StatusDot tone={statusTone(session)} />}
                      label={session.title}
                      detail={session.subtitle}
                      active={dockOpen && session.id === activeId}
                      actions={
                        <>
                          <span
                            className="max-w-[18rem] shrink-0 truncate font-mono text-[10.5px] text-muted-foreground"
                            title={describeStatus(session)}
                          >
                            {describeStatus(session)}
                          </span>
                          <Button size="sm" onClick={() => focus(session.id)}>
                            Focus
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => close(session.id)}>
                            {isFinished(session) ? "Dismiss" : "Close"}
                          </Button>
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
