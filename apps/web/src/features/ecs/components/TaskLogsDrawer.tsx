import type { EcsTask } from "@faws/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, X } from "lucide-react";

import { LogsPane } from "~/features/ecs/components/LogsPane";
import { StatusDot } from "~/components/ui/status-dot";
import { taskTone } from "~/lib/status";

/**
 * One task's logs, inline under the table it was picked from.
 *
 * Opening a task's output shouldn't cost the context you were reading it in —
 * during a rollout the interesting question is "what is the new task saying
 * *while* the old one still serves traffic", and navigating away to answer it
 * loses the rollout panel you were watching.
 */
export function TaskLogsDrawer({ task, onClose }: { task: EcsTask; onClose: () => void }) {
  const tone = taskTone(task);

  return (
    <section className="flex h-80 shrink-0 flex-col border-t border-border">
      <header className="flex items-center gap-2.5 border-b border-border px-3.5 py-1.5">
        <StatusDot tone={tone.tone} pulse={tone.pulse} />
        <span className="font-mono text-[11.5px]">{task.id}</span>
        <span className="font-mono text-[10.5px] text-muted-foreground">{task.taskDefinition}</span>
        {task.stoppedReason ? (
          <span className="truncate font-mono text-[10.5px] text-danger">{task.stoppedReason}</span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <Link
            to="/ecs/clusters/$cluster/tasks/$taskId"
            params={{ cluster: task.clusterName, taskId: task.id }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            open task <ArrowUpRight className="size-3" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close logs"
            className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" strokeWidth={2.2} />
          </button>
        </div>
      </header>

      <LogsPane taskDefinition={task.taskDefinition} taskId={task.id} scopeLabel={task.id} />
    </section>
  );
}
