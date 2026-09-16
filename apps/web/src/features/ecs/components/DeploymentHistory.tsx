import type { EcsService, ServiceDeploymentRecord } from "@faws/contracts";
import { formatDuration, relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { BellRing, History, ShieldAlert, Undo2 } from "lucide-react";
import * as React from "react";

import { Segmented } from "~/components/segmented";
import { Badge } from "~/components/ui/badge";
import { CopyIcon } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows } from "~/components/ui/spinner";
import { StatusDot, type StatusTone } from "~/components/ui/status-dot";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { LogsPane } from "~/features/ecs/components/LogsPane";
import { CountMeter } from "~/components/meter";
import { type ClassifiedEvent } from "~/lib/deployment";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

type Pane = "summary" | "events" | "logs";

/**
 * Every deployment this service has had, with the detail the live rollout view
 * shows — plus two things only the history API knows: the circuit breaker's
 * real threshold and failure count, and the CloudWatch alarms wired as
 * rollback monitors.
 *
 * The list is the left rail rather than a table because a deployment is
 * something you compare against its neighbours: what changed, how long it
 * took, whether it stuck.
 */
export function DeploymentHistory({
  cluster,
  service,
  events,
}: {
  cluster: string;
  service: EcsService;
  events: ReadonlyArray<ClassifiedEvent>;
}) {
  const scope = useAwsScope();
  const { refreshSeconds } = useScope();
  const [selectedArn, setSelectedArn] = React.useState<string | null>(null);

  const history = useQuery({
    ...trpc.ecs.deploymentHistory.queryOptions({
      ...scope,
      cluster,
      service: service.name,
      limit: 25,
    }),
    ...(refreshSeconds > 0 ? { refetchInterval: refreshSeconds * 1000 } : {}),
  });

  const records = history.data ?? [];
  const selected = records.find((record) => record.arn === selectedArn) ?? records[0] ?? null;

  if (history.isPending) return <LoadingRows rows={8} />;
  if (history.isError) {
    return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  }
  if (records.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No deployment history"
        hint="ECS records deployments through the ListServiceDeployments API, which only covers services deployed since it shipped. Older services show history from their next deployment."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ul className="w-72 shrink-0 overflow-auto border-r border-border">
        {records.map((record) => {
          const tone = statusTone(record.status);
          const active = record.arn === selected?.arn;
          return (
            <li key={record.arn}>
              <button
                type="button"
                onClick={() => setSelectedArn(record.arn)}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors",
                  active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="flex items-center gap-2">
                  <StatusDot tone={tone} pulse={isRunning(record.status)} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                    {record.target?.taskDefinition ?? record.id}
                  </span>
                  {record.rollback ? (
                    <Undo2 className="size-3 shrink-0 text-danger" strokeWidth={2} />
                  ) : null}
                </span>
                <span className="flex items-baseline gap-2 pl-4 font-mono text-[10px] text-muted-foreground">
                  <span className="truncate">{statusLabel(record.status)}</span>
                  <span className="ml-auto shrink-0 tabular">{relativeTime(record.createdAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected ? (
        <DeploymentDetail cluster={cluster} service={service} record={selected} events={events} />
      ) : null}
    </div>
  );
}

function DeploymentDetail({
  service,
  record,
  events,
}: {
  cluster: string;
  service: EcsService;
  record: ServiceDeploymentRecord;
  events: ReadonlyArray<ClassifiedEvent>;
}) {
  const [pane, setPane] = React.useState<Pane>("summary");

  // Service events only retain about the last hundred lines, so a deployment
  // from last week legitimately has none. The window is matched rather than
  // the id, because ECS doesn't tag every line with a deployment.
  const windowed = React.useMemo(() => {
    const from = record.startedAt ?? record.createdAt;
    if (!from) return [];
    const start = new Date(from).getTime();
    const end = record.finishedAt ?? record.stoppedAt;
    // A deployment still in flight has no upper bound - every event since it
    // started belongs to it.
    const stop = end ? new Date(end).getTime() + 60_000 : Number.POSITIVE_INFINITY;
    return events.filter((event) => {
      if (!event.createdAt) return false;
      const at = new Date(event.createdAt).getTime();
      return at >= start && at <= stop;
    });
  }, [events, record]);

  const startMs = record.startedAt ? new Date(record.startedAt).getTime() : undefined;
  const endRaw = record.finishedAt ?? record.stoppedAt;
  const endMs = endRaw ? new Date(endRaw).getTime() + 120_000 : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2">
        <StatusDot tone={statusTone(record.status)} pulse={isRunning(record.status)} />
        <Badge tone={badgeTone(record.status)}>{statusLabel(record.status)}</Badge>

        <span className="flex items-baseline gap-1.5 font-mono text-[11.5px]">
          {record.source.length > 0 ? (
            <>
              <span className="text-muted-foreground line-through">
                {record.source.map((r) => r.taskDefinition ?? "?").join(", ")}
              </span>
              <span className="text-muted-foreground/60">→</span>
            </>
          ) : null}
          <span>{record.target?.taskDefinition ?? "?"}</span>
        </span>

        <span
          className="font-mono text-[10.5px] text-muted-foreground tabular"
          title={fullTimestamp(record.createdAt)}
        >
          {relativeTime(record.createdAt)}
          {record.durationSeconds !== null
            ? ` · took ${formatDuration(record.durationSeconds)}`
            : ""}
        </span>

        <span className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted-foreground">{record.id}</span>
          <CopyIcon value={record.arn} label="deployment ARN" />
        </span>
      </header>

      {record.statusReason ? (
        <p
          className={cn(
            "border-b border-border px-3.5 py-2 font-mono text-[11.5px]",
            isFailure(record.status) ? "text-danger" : "text-muted-foreground",
          )}
        >
          {record.statusReason}
        </p>
      ) : null}

      <div className="flex items-center gap-2.5 px-3.5 py-2">
        <Segmented<Pane>
          value={pane}
          onChange={setPane}
          options={[
            { value: "summary", label: "Summary" },
            { value: "events", label: "Events", count: windowed.length },
            { value: "logs", label: "Logs" },
          ]}
        />
      </div>

      {pane === "summary" ? <Summary record={record} service={service} /> : null}

      {pane === "events" ? (
        windowed.length === 0 ? (
          <EmptyState
            icon={History}
            title="No service events from this window"
            hint="ECS keeps only the most recent service events, so older deployments lose theirs."
          />
        ) : (
          <ol className="min-h-0 flex-1 overflow-auto px-3.5 pb-3">
            {windowed.map((event) => (
              <li key={event.id} className="flex items-baseline gap-2.5 py-1">
                <StatusDot tone={event.tone} className="translate-y-[3px]" />
                <time
                  className="w-20 shrink-0 font-mono text-[10.5px] text-muted-foreground tabular"
                  title={fullTimestamp(event.createdAt)}
                >
                  {relativeTime(event.createdAt)}
                </time>
                <span className="w-[4.5rem] shrink-0 font-mono text-[10px] text-muted-foreground/70 uppercase">
                  {event.label}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[12px]",
                    event.tone === "danger" && "text-danger",
                  )}
                >
                  {event.message}
                </span>
              </li>
            ))}
          </ol>
        )
      ) : null}

      {pane === "logs" ? (
        record.target?.taskDefinition ? (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border">
            <LogsPane
              taskDefinition={record.target.taskDefinition}
              scopeLabel={`${record.target.taskDefinition} during this deployment`}
              startTime={startMs}
              endTime={endMs}
            />
          </div>
        ) : (
          <EmptyState icon={History} title="This deployment has no resolved task definition" />
        )
      ) : null}
    </div>
  );
}

function Summary({ record, service }: { record: ServiceDeploymentRecord; service: EcsService }) {
  const breaker = record.circuitBreaker;
  const alarms = record.alarms;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3.5 pb-4">
      <Section title="Revisions">
        <div className="flex flex-col gap-1.5">
          {record.target ? <RevisionRow label="target" revision={record.target} highlight /> : null}
          {record.source.map((revision) => (
            <RevisionRow key={revision.arn} label="source" revision={revision} />
          ))}
        </div>
      </Section>

      <Section title="Timing">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 lg:grid-cols-4">
          <Fact label="Created" value={fullTimestamp(record.createdAt)} />
          <Fact label="Started" value={fullTimestamp(record.startedAt)} />
          <Fact
            label={record.stoppedAt ? "Stopped" : "Finished"}
            value={fullTimestamp(record.finishedAt ?? record.stoppedAt)}
          />
          <Fact
            label="Duration"
            value={record.durationSeconds === null ? "-" : formatDuration(record.durationSeconds)}
          />
          {record.lifecycleStage ? (
            <Fact label="Lifecycle stage" value={record.lifecycleStage} />
          ) : null}
        </dl>
      </Section>

      <Section title="Rollback monitors">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <ShieldAlert
              className={cn(
                "size-3.5 shrink-0",
                breaker?.status === "TRIGGERED" ? "text-danger" : "text-muted-foreground",
              )}
              strokeWidth={1.9}
            />
            <span className="text-[12.5px]">Circuit breaker</span>
            {breaker ? (
              <>
                <Badge tone={breaker.status === "TRIGGERED" ? "danger" : "neutral"}>
                  {statusLabel(breaker.status ?? "monitoring")}
                </Badge>
                {/* A disabled breaker reports 0 of 0, which reads as a real
                    measurement rather than an absent one. */}
                {breaker.status !== "DISABLED" && breaker.threshold ? (
                  <span className="font-mono text-[11px] text-muted-foreground tabular">
                    {breaker.failureCount ?? 0} of {breaker.threshold} failures
                  </span>
                ) : null}
              </>
            ) : (
              <span className="font-mono text-[11px] text-muted-foreground">
                {service.circuitBreaker?.enabled ? "not reported" : "not configured"}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <BellRing
              className={cn(
                "size-3.5 shrink-0",
                alarms?.status === "TRIGGERED" ? "text-danger" : "text-muted-foreground",
              )}
              strokeWidth={1.9}
            />
            <span className="text-[12.5px]">CloudWatch alarms</span>
            {alarms && alarms.alarmNames.length > 0 ? (
              <>
                <Badge tone={alarms.status === "TRIGGERED" ? "danger" : "neutral"}>
                  {statusLabel(alarms.status ?? "monitoring")}
                </Badge>
                {alarms.alarmNames.map((name) => (
                  <span
                    key={name}
                    className={cn(
                      "rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]",
                      alarms.triggeredAlarmNames.includes(name) && "bg-danger/15 text-danger",
                    )}
                  >
                    {name}
                  </span>
                ))}
              </>
            ) : (
              <span className="font-mono text-[11px] text-muted-foreground">
                {alarms?.status === "DISABLED" ? "disabled" : "none configured"}
              </span>
            )}
          </div>
        </div>
      </Section>

      {record.rollback ? (
        <Section title="Rollback">
          <div className="rounded-md border border-danger/35 bg-danger/8 px-3 py-2">
            <p className="flex items-center gap-2 text-[12.5px] text-danger">
              <Undo2 className="size-3.5 shrink-0" strokeWidth={2} />
              Rolled back to {record.rollback.taskDefinition ?? "the previous revision"}
              {record.rollback.startedAt ? ` · ${relativeTime(record.rollback.startedAt)}` : ""}
            </p>
            {record.rollback.reason ? (
              <p className="mt-1 font-mono text-[11.5px] text-danger/90">
                {record.rollback.reason}
              </p>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function RevisionRow({
  label,
  revision,
  highlight = false,
}: {
  label: string;
  revision: {
    taskDefinition: string | null;
    requestedCount: number | null;
    runningCount: number | null;
    pendingCount: number | null;
  };
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-12 shrink-0 font-mono text-[9.5px] tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className={cn("font-mono text-[12px]", highlight && "text-foreground")}>
        {revision.taskDefinition ?? "unresolved revision"}
      </span>
      <CountMeter
        running={revision.runningCount ?? 0}
        desired={revision.requestedCount ?? revision.runningCount ?? 0}
        pending={revision.pendingCount ?? 0}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/60 py-3 last:border-b-0">
      <p className="mb-2 font-mono text-[9.5px] tracking-[0.22em] text-muted-foreground uppercase">
        {title}
      </p>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="font-mono text-[9.5px] tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-mono text-[11.5px] tabular">{value}</dd>
    </div>
  );
}

function isRunning(status: string): boolean {
  return status === "IN_PROGRESS" || status === "PENDING" || status.startsWith("ROLLBACK_IN");
}

function isFailure(status: string): boolean {
  return status.startsWith("ROLLBACK") || status === "STOPPED";
}

function statusTone(status: string): StatusTone {
  if (status === "SUCCESSFUL") return "success";
  if (status === "ROLLBACK_SUCCESSFUL") return "warning";
  if (status === "ROLLBACK_FAILED" || status === "STOPPED") return "danger";
  if (isRunning(status)) return "info";
  return "neutral";
}

function badgeTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  const tone = statusTone(status);
  return tone === "neutral" ? "neutral" : tone;
}

/** ECS's SCREAMING_SNAKE statuses, made readable without losing precision. */
function statusLabel(status: string): string {
  return status.toLowerCase().replaceAll("_", " ");
}
