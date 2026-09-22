import type { EcsTask, ResourceRef } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, Pencil, Rocket, ScrollText } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { PinButton } from "~/components/PinButton";
import { DeploymentHistory } from "~/features/ecs/components/DeploymentHistory";
import {
  DeploymentProgress,
  RolloutFailureNotice,
} from "~/features/ecs/components/DeploymentProgress";
import { KeyValue, KeyValueGrid } from "~/components/kv";
import { LogsPane } from "~/features/ecs/components/LogsPane";
import { TaskLogsDrawer } from "~/features/ecs/components/TaskLogsDrawer";
import { CountMeter } from "~/components/meter";
import { MetricChart } from "~/components/metric-chart";
import { Segmented } from "~/components/segmented";
import { TargetHealthPane } from "~/features/ecs/components/TargetHealthPane";
import { DisabledHint, useDisabledReason } from "~/components/WriteGuard";
import { UpdateServiceDialog } from "~/features/ecs/components/UpdateServiceDialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { StatusDot } from "~/components/ui/status-dot";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { fullTimestamp } from "~/lib/format";
import { classifyEvent, type ClassifiedEvent } from "~/lib/deployment";
import { describe } from "~/lib/hotkeys";
import { useOverlaysOpen } from "~/stores/overlays";
import { useRecordVisit } from "~/stores/recents";
import { useTabSearch } from "~/hooks/useTabSearch";
import { serviceTone, taskTone } from "~/lib/status";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/** The tabs, in the order they are shown; the first is the default. */
export const SERVICE_TABS = [
  "tasks",
  "deployments",
  "events",
  "targets",
  "metrics",
  "logs",
] as const;

type Tab = (typeof SERVICE_TABS)[number];

/**
 * One service, everything about it on one screen.
 *
 * The TUI makes deployments, events, tasks and metrics four separate views you
 * page between. They answer one question together — "is this rollout going
 * well?" — so here the summary is always pinned and the tabs only swap the
 * evidence below it.
 */
export function ServicePage({ cluster, service }: { cluster: string; service: string }) {
  const scope = useAwsScope();
  const { region } = useScope();
  const [tab, setTab] = useTabSearch(SERVICE_TABS, "tasks");
  const [updating, setUpdating] = React.useState(false);
  // Refused up front rather than at call time: the dialog would otherwise
  // open, take a change, and only then report that writes are off.
  const updateReason = useDisabledReason("write");
  const overlayOpen = useOverlaysOpen();

  const detail = useQuery(trpc.ecs.service.queryOptions({ ...scope, cluster, service }));
  const tasks = useQuery({
    ...trpc.ecs.tasks.queryOptions({ ...scope, cluster, service, desiredStatus: "RUNNING" }),
    enabled: tab === "tasks",
  });
  const metrics = useQuery({
    ...trpc.ecs.metrics.queryOptions({ ...scope, cluster, service, windowMinutes: 180 }),
    enabled: tab === "metrics",
  });

  // Recorded from the route rather than from `detail.data`, so a service whose
  // summary is still loading - or has just failed to load - still counts as
  // somewhere you went. The cluster is the detail line because a service name
  // on its own is ambiguous across clusters and the key is not.
  const target = React.useMemo<ResourceRef>(
    () => ({
      kind: "ecs-service",
      id: `${cluster}/${service}`,
      label: service,
      detail: cluster,
      scope: { profile: scope.profile, region: scope.region, connectionId: "" },
      to: `/ecs/clusters/${encodeURIComponent(cluster)}/services/${encodeURIComponent(service)}`,
    }),
    [cluster, service, scope.profile, scope.region],
  );
  useRecordVisit(target);

  const consoleUrl = `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${encodeURIComponent(cluster)}/services/${encodeURIComponent(service)}?region=${region}`;

  useHotkeys(
    [
      {
        hotkey: "B",
        callback: () => window.open(consoleUrl, "_blank", "noopener"),
        options: { meta: describe("Context", "Open in the AWS console") },
      },
    ],
    { preventDefault: true, enabled: !overlayOpen },
  );

  if (detail.isPending)
    return (
      <Panel className="flex-1">
        <LoadingRows rows={10} />
      </Panel>
    );
  if (detail.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </Panel>
    );
  }
  if (!detail.data) {
    return (
      <Panel className="flex-1">
        <EmptyState icon={Rocket} title={`Service "${service}" not found in ${cluster}`} />
      </Panel>
    );
  }

  const { service: summary, deployments, events } = detail.data;
  const tone = serviceTone(summary.deploymentState);
  const classified = events.map(classifyEvent);
  const rolling = summary.deploymentState === "deploying" || summary.deploymentState === "degraded";
  const settledFailure =
    !rolling && deployments.find((d) => d.status === "PRIMARY")?.rolloutState === "FAILED";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Panel className="shrink-0">
        <PanelHeader>
          <StatusDot tone={tone.tone} pulse={tone.pulse} />
          <PanelTitle className="text-foreground normal-case tracking-normal text-[13px] font-medium">
            {summary.name}
          </PanelTitle>
          <Badge tone={tone.tone === "neutral" ? "neutral" : tone.tone}>{tone.label}</Badge>
          <CountMeter
            running={summary.runningCount}
            desired={summary.desiredCount}
            pending={summary.pendingCount}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <PinButton target={target} />
            <DisabledHint reason={updateReason}>
              <Button
                onClick={() => setUpdating(true)}
                disabled={updateReason !== null}
                title="Update this service"
              >
                <Pencil className="size-3" /> Update
              </Button>
            </DisabledHint>
            <Button
              onClick={() => window.open(consoleUrl, "_blank", "noopener")}
              title="Open in the AWS console (b)"
            >
              <ExternalLink className="size-3" /> Console
            </Button>
          </div>
        </PanelHeader>
        <KeyValueGrid className="px-3.5 py-2.5">
          <KeyValue label="Task definition">{summary.taskDefinition}</KeyValue>
          <KeyValue label="Launch type">{summary.launchType ?? "capacity provider"}</KeyValue>
          <KeyValue label="Platform">{summary.platformVersion ?? "-"}</KeyValue>
          <KeyValue label="Scheduling">{summary.schedulingStrategy ?? "-"}</KeyValue>
          <KeyValue label="Exec enabled">{summary.enableExecuteCommand ? "yes" : "no"}</KeyValue>
          <KeyValue label="Deployments">{summary.activeDeployments}</KeyValue>
          <KeyValue label="Load balancers">
            {summary.loadBalancers.length > 0 ? (
              <button
                type="button"
                onClick={() => setTab("targets")}
                className="cursor-pointer underline decoration-border underline-offset-2 hover:decoration-foreground"
              >
                {summary.loadBalancers.length} · check health
              </button>
            ) : (
              "-"
            )}
          </KeyValue>
          <KeyValue label="Circuit breaker">
            {summary.circuitBreaker?.enabled
              ? summary.circuitBreaker.rollback
                ? "on, rolls back"
                : "on"
              : "off"}
          </KeyValue>
          <KeyValue label="Created">{relativeTime(summary.createdAt)}</KeyValue>
        </KeyValueGrid>
      </Panel>

      {rolling ? (
        <DeploymentProgress
          cluster={cluster}
          service={summary}
          deployments={deployments}
          events={classified}
          onOpenTasks={() => setTab("tasks")}
        />
      ) : null}
      {settledFailure ? (
        <RolloutFailureNotice
          reason={
            deployments.find((d) => d.status === "PRIMARY")?.rolloutStateReason ??
            "The last deployment failed."
          }
        />
      ) : null}

      <UpdateServiceDialog service={summary} open={updating} onClose={() => setUpdating(false)} />

      <Panel className="min-h-0 flex-1">
        <PanelHeader>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "tasks", label: "Tasks", count: tasks.data?.length },
              { value: "deployments", label: "Deployments" },
              { value: "events", label: "Events", count: events.length },
              ...(summary.loadBalancers.length > 0
                ? [{ value: "targets" as const, label: "Target health" }]
                : []),
              { value: "metrics", label: "Metrics" },
              { value: "logs", label: "Logs" },
            ]}
          />
          {tab === "metrics" && metrics.isFetching ? <Spinner /> : null}
        </PanelHeader>

        {tab === "tasks" ? <ServiceTasks cluster={cluster} query={tasks} /> : null}
        {tab === "deployments" ? (
          <DeploymentHistory cluster={cluster} service={summary} events={classified} />
        ) : null}
        {tab === "events" ? <EventsList events={classified} /> : null}
        {tab === "targets" ? <TargetHealthPane cluster={cluster} service={service} /> : null}
        {tab === "logs" ? (
          <LogsPane
            taskDefinition={summary.taskDefinition}
            scopeLabel={`every task in ${summary.name}`}
          />
        ) : null}
        {tab === "metrics" ? (
          <div className="grid gap-4 overflow-auto p-4 lg:grid-cols-2">
            {metrics.isError ? (
              <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
            ) : (
              (metrics.data ?? []).map((series) => (
                <MetricChart key={series.metric} series={series} height={160} />
              ))
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function ServiceTasks({
  cluster,
  query,
}: {
  cluster: string;
  query: {
    data: EcsTask[] | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
}) {
  const navigate = useNavigate();
  const [logsFor, setLogsFor] = React.useState<EcsTask | null>(null);

  const columns = React.useMemo<Column<EcsTask>[]>(
    () => [
      {
        id: "id",
        header: "Task",
        width: "14rem",
        value: (row) => row.id,
        cell: (row) => {
          const tone = taskTone(row);
          return (
            <span className="flex items-center gap-2">
              <StatusDot tone={tone.tone} pulse={tone.pulse} />
              <span className="truncate font-mono text-[11.5px]">{row.id}</span>
            </span>
          );
        },
      },
      { id: "status", header: "Status", width: "8rem", mono: true, value: (row) => row.lastStatus },
      {
        id: "health",
        header: "Health",
        width: "7rem",
        value: (row) => row.health,
        cell: (row) => (
          <Badge
            tone={
              row.health === "HEALTHY"
                ? "success"
                : row.health === "UNHEALTHY"
                  ? "danger"
                  : "neutral"
            }
          >
            {row.health}
          </Badge>
        ),
      },
      {
        id: "containers",
        header: "Containers",
        value: (row) => row.containers.map((c) => c.name).join(", "),
        cell: (row) => (
          <span className="flex items-center gap-1.5">
            {row.containers.map((container) => (
              <span
                key={container.name}
                className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]"
              >
                <StatusDot
                  tone={container.lastStatus === "RUNNING" ? "success" : "warning"}
                  className="size-[5px]"
                />
                {container.name}
              </span>
            ))}
          </span>
        ),
      },
      {
        id: "taskdef",
        header: "Revision",
        width: "10rem",
        mono: true,
        value: (row) => row.taskDefinition,
      },
      {
        id: "az",
        header: "AZ",
        width: "8rem",
        mono: true,
        value: (row) => row.availabilityZone ?? "-",
      },
      {
        id: "ip",
        header: "Private IP",
        width: "9rem",
        mono: true,
        value: (row) => row.privateIp ?? "-",
      },
      {
        id: "age",
        header: "Age",
        width: "8rem",
        align: "right",
        mono: true,
        value: (row) => row.startedAt ?? "",
        cell: (row) => <span className="text-muted-foreground">{relativeTime(row.startedAt)}</span>,
      },
      {
        // Reading one task's output is the most common next step from this
        // table, and during a rollout it is the whole question - so it opens
        // in place rather than navigating away from the deployment panel.
        id: "logs",
        header: "",
        width: "3.5rem",
        align: "right",
        value: () => "",
        cell: (row) => (
          <button
            type="button"
            title={`Show logs for ${row.id}`}
            aria-label={`Show logs for ${row.id}`}
            onClick={(event) => {
              event.stopPropagation();
              setLogsFor((current) => (current?.arn === row.arn ? null : row));
            }}
            className="inline-grid size-5 cursor-pointer place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ScrollText className="size-3.5" strokeWidth={1.8} />
          </button>
        ),
      },
    ],
    [],
  );

  if (query.isPending) return <LoadingRows />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DataTable
        rows={query.data ?? []}
        columns={columns}
        rowKey={(row) => row.arn}
        onOpen={(row) =>
          void navigate({
            to: "/ecs/clusters/$cluster/tasks/$taskId",
            params: { cluster, taskId: row.id },
          })
        }
        emptyState={<EmptyState icon={Rocket} title="No running tasks for this service" />}
      />
      {logsFor ? <TaskLogsDrawer task={logsFor} onClose={() => setLogsFor(null)} /> : null}
    </div>
  );
}

/**
 * Service events as a timeline rather than a table: they are prose, they
 * arrive newest-first, and each one is tagged by kind so the load-balancer
 * chatter is visually separable from the reason something is stuck.
 */
function EventsList({ events }: { events: ReadonlyArray<ClassifiedEvent> }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No service events"
        hint="Events are ECS's own scheduling messages. For what your containers printed, use the Logs tab."
      />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <ol className="flex flex-col">
        {events.map((event) => (
          <li key={event.id} className="flex gap-3 border-l border-border py-1.5 pl-4 last:pb-0">
            <span className="relative -ml-[21px] mt-1.5 shrink-0">
              <StatusDot tone={event.tone} />
            </span>
            <time
              className="w-32 shrink-0 font-mono text-[10.5px] text-muted-foreground tabular"
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
            <p className={cn("text-[12.5px]", event.tone === "danger" && "text-danger")}>
              {event.message}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
