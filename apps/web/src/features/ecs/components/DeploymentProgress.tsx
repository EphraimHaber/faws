import type { EcsDeployment, EcsService } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import * as React from "react";

import { LogsPane } from "~/features/ecs/components/LogsPane";
import { CountMeter } from "~/components/meter";
import { Segmented } from "~/components/segmented";
import { TargetHealthPane } from "~/features/ecs/components/TargetHealthPane";
import { Badge } from "~/components/ui/badge";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { StatusDot } from "~/components/ui/status-dot";
import { TextAction } from "~/components/ui/text-action";
import { fullTimestamp } from "~/lib/format";
import {
  circuitBreakerThreshold,
  type ClassifiedEvent,
  rolloutView,
  type RolloutStep,
} from "~/lib/deployment";
import { cn } from "~/lib/utils";

type Pane = "steps" | "events" | "targets" | "logs";

/**
 * What the service is doing *right now*, shown only while it matters.
 *
 * A rollout is the moment an operator most needs a console, and it is exactly
 * where ECS is least legible: the state is spread across two deployment
 * records, a rollout enum, a failure counter, and a stream of prose. This
 * pulls the four together — the steps, the circuit breaker, the events that
 * belong to *this* deployment, and the new revision's own log output.
 */
export function DeploymentProgress({
  cluster,
  service,
  deployments,
  events,
  onOpenTasks,
}: {
  cluster: string;
  service: EcsService;
  deployments: ReadonlyArray<EcsDeployment>;
  events: ReadonlyArray<ClassifiedEvent>;
  onOpenTasks: () => void;
}) {
  const [pane, setPane] = React.useState<Pane>("steps");
  const view = React.useMemo(
    () => rolloutView(service, deployments, events),
    [service, deployments, events],
  );

  // Events ECS attributed to this deployment, newest first; if it attributed
  // none, recent service events are still the best available narrative.
  const rolloutEvents = React.useMemo(() => {
    if (!view) return [];
    const owned = events.filter((event) => event.deploymentId === view.primary.id);
    return owned.length > 0 ? owned : events.slice(0, 25);
  }, [events, view]);

  if (!view) return null;

  const { primary, superseded, failing, rollingBack, settled, percent } = view;
  const tone = rollingBack ? "danger" : failing ? "warning" : settled ? "success" : "info";

  return (
    <Panel
      className={cn(
        "shrink-0",
        tone === "danger"
          ? "border-danger/45"
          : tone === "warning"
            ? "border-warning/45"
            : tone === "success"
              ? "border-success/45"
              : "border-info/45",
      )}
    >
      <PanelHeader
        className={cn(
          tone === "danger"
            ? "bg-danger/8"
            : tone === "warning"
              ? "bg-warning/8"
              : tone === "success"
                ? "bg-success/8"
                : "bg-info/8",
        )}
      >
        <StatusDot tone={tone} pulse={!rollingBack && !settled} />
        <PanelTitle className="text-[12px] tracking-normal text-foreground normal-case">
          {rollingBack ? "Rolling back" : settled ? "Deployed" : "Deploying"}
        </PanelTitle>

        <span className="flex items-baseline gap-1.5 font-mono text-[11.5px]">
          {superseded.length > 0 ? (
            <>
              <span className="text-muted-foreground line-through">
                {superseded.map((d) => d.taskDefinition).join(", ")}
              </span>
              <span className="text-muted-foreground/60">→</span>
            </>
          ) : null}
          <span className="text-foreground">{primary.taskDefinition}</span>
        </span>

        <ProgressBar percent={percent} tone={tone} />

        <span
          className="font-mono text-[10.5px] text-muted-foreground tabular"
          title={fullTimestamp(settled ? primary.updatedAt : primary.createdAt)}
        >
          {settled
            ? `finished ${relativeTime(primary.updatedAt)}`
            : `started ${relativeTime(primary.createdAt)}`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <CircuitBreaker service={service} deployment={primary} rollingBack={rollingBack} />
        </div>
      </PanelHeader>

      {view.reason ? (
        <p
          className={cn(
            "border-b border-border px-3.5 py-2 font-mono text-[11.5px]",
            rollingBack ? "text-danger" : "text-muted-foreground",
          )}
        >
          {view.reason}
        </p>
      ) : null}

      <div className="flex items-center gap-2.5 px-3.5 py-2">
        <Segmented<Pane>
          value={pane}
          onChange={setPane}
          options={[
            { value: "steps", label: "Steps" },
            { value: "events", label: "Events", count: rolloutEvents.length },
            ...(service.loadBalancers.length > 0
              ? [{ value: "targets" as const, label: "Target health" }]
              : []),
            { value: "logs", label: "New revision logs" },
          ]}
        />
        <TextAction onClick={onOpenTasks}>see the individual tasks</TextAction>

        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
            new
            <CountMeter
              running={primary.runningCount}
              desired={primary.desiredCount}
              pending={primary.pendingCount}
            />
          </span>
          {superseded.map((deployment) => (
            <span
              key={deployment.id}
              className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground"
            >
              old
              <CountMeter running={deployment.runningCount} desired={deployment.runningCount} />
            </span>
          ))}
          {primary.failedTasks > 0 ? (
            <Badge tone="danger">{primary.failedTasks} failed</Badge>
          ) : null}
        </div>
      </div>

      {pane === "steps" ? <Steps steps={view.steps} /> : null}
      {pane === "events" ? <EventTimeline events={rolloutEvents} /> : null}
      {pane === "targets" ? (
        <div className="border-t border-border">
          <TargetHealthPane cluster={cluster} service={service.name} />
        </div>
      ) : null}
      {pane === "logs" ? (
        <div className="flex h-72 min-h-0 flex-col border-t border-border">
          <LogsPane
            taskDefinition={primary.taskDefinition}
            scopeLabel={`revision ${primary.taskDefinition}`}
          />
        </div>
      ) : null}
    </Panel>
  );
}

function ProgressBar({
  percent,
  tone,
}: {
  percent: number;
  tone: "danger" | "warning" | "success" | "info";
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1 w-24 rounded-full bg-muted">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
            tone === "danger"
              ? "bg-danger"
              : tone === "warning"
                ? "bg-warning"
                : tone === "success"
                  ? "bg-success"
                  : "bg-info",
          )}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="font-mono text-[10.5px] text-muted-foreground tabular">{percent}%</span>
    </span>
  );
}

/**
 * The circuit breaker deserves its own chip: when rollback is enabled, a
 * failing deployment will silently revert, and "why did my new version
 * disappear" is one of the worst surprises ECS hands out.
 */
function CircuitBreaker({
  service,
  deployment,
  rollingBack,
}: {
  service: EcsService;
  deployment: EcsDeployment;
  rollingBack: boolean;
}) {
  const breaker = service.circuitBreaker;

  if (!breaker?.enabled) {
    return (
      <span
        className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground"
        title="No deployment circuit breaker: a failing rollout will keep retrying until you stop it."
      >
        <ShieldAlert className="size-3" strokeWidth={1.9} />
        no circuit breaker
      </span>
    );
  }

  const threshold = circuitBreakerThreshold(deployment.desiredCount);
  const tone = rollingBack ? "danger" : deployment.failedTasks > 0 ? "warning" : "neutral";

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 font-mono text-[10.5px]",
        tone === "danger"
          ? "text-danger"
          : tone === "warning"
            ? "text-warning"
            : "text-muted-foreground",
      )}
      title={
        breaker.rollback
          ? `Circuit breaker with rollback: after roughly ${threshold} consecutive task failures ECS restores the previous task definition.`
          : `Circuit breaker without rollback: after roughly ${threshold} consecutive task failures ECS stops the deployment but leaves it in place.`
      }
    >
      {rollingBack ? <ShieldAlert className="size-3" /> : <ShieldCheck className="size-3" />}
      breaker {breaker.rollback ? "+ rollback" : "on"}
      <span className="tabular">
        {deployment.failedTasks}/{threshold}
      </span>
    </span>
  );
}

function Steps({ steps }: { steps: ReadonlyArray<RolloutStep> }) {
  return (
    <ol className="flex flex-col border-t border-border">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={cn(
            "flex items-start gap-3 px-3.5 py-2.5",
            index > 0 && "border-t border-border/50",
            step.state === "active" && "bg-accent/40",
          )}
        >
          <StepIcon state={step.state} />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-[12.5px]",
                step.state === "pending" && "text-muted-foreground",
                step.state === "failed" && "text-danger",
              )}
            >
              {step.title}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ state }: { state: RolloutStep["state"] }) {
  const className = "mt-0.5 size-3.5 shrink-0";
  if (state === "done")
    return <Check className={cn(className, "text-success")} strokeWidth={2.2} />;
  if (state === "active") {
    return <Loader2 className={cn(className, "animate-spin text-info")} strokeWidth={2} />;
  }
  if (state === "failed") return <X className={cn(className, "text-danger")} strokeWidth={2.4} />;
  return <CircleDashed className={cn(className, "text-muted-foreground/50")} strokeWidth={1.8} />;
}

function EventTimeline({ events }: { events: ReadonlyArray<ClassifiedEvent> }) {
  if (events.length === 0) {
    return (
      <p className="border-t border-border px-3.5 py-6 text-center text-[12px] text-muted-foreground">
        ECS hasn't reported an event for this deployment yet.
      </p>
    );
  }

  return (
    <ol className="max-h-72 overflow-auto border-t border-border px-3.5 py-2">
      {events.map((event) => (
        <li key={event.id} className="flex items-baseline gap-2.5 py-1">
          <StatusDot tone={event.tone} className="translate-y-[3px]" />
          <time
            className="w-20 shrink-0 font-mono text-[10.5px] text-muted-foreground tabular"
            title={fullTimestamp(event.createdAt)}
          >
            {relativeTime(event.createdAt)}
          </time>
          <span
            className={cn(
              "w-[4.5rem] shrink-0 font-mono text-[10px] uppercase",
              event.tone === "danger"
                ? "text-danger"
                : event.tone === "warning"
                  ? "text-warning"
                  : event.tone === "success"
                    ? "text-success"
                    : "text-muted-foreground/70",
            )}
          >
            {event.label}
          </span>
          <span
            className={cn("min-w-0 flex-1 text-[12px]", event.tone === "danger" && "text-danger")}
          >
            {event.message}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Shown on a settled service that failed its last rollout. */
export function RolloutFailureNotice({ reason }: { reason: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-danger/40 bg-danger/8 px-3.5 py-2">
      <AlertTriangle className="size-3.5 shrink-0 text-danger" strokeWidth={1.9} />
      <p className="font-mono text-[11.5px] text-danger">{reason}</p>
    </div>
  );
}
