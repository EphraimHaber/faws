import type { EcsContainerInstance, EcsService, EcsTask, ResourceRef } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Boxes, Cpu, ScrollText, Server, TerminalSquare } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { PinButton } from "~/components/PinButton";
import { CountMeter } from "~/components/meter";
import { Segmented } from "~/components/segmented";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { StatusDot } from "~/components/ui/status-dot";
import { Button } from "~/components/ui/button";
import { TextAction } from "~/components/ui/text-action";
import { useAwsScope } from "~/contexts/ScopeContext";
import { useRecordVisit } from "~/stores/recents";
import { useSessions } from "~/stores/sessions";
import { cpuLabel, memoryLabel, uptimeLabel } from "~/lib/format";
import { serviceTone, taskTone } from "~/lib/status";
import { HiddenCount, SilenceMenu } from "~/components/SilenceMenu";
import { TaskLogsDrawer } from "~/features/ecs/components/TaskLogsDrawer";
import { partitionSilenced, useSilenced, useServiceSilence } from "~/stores/silenced";
import { trpc } from "~/lib/trpc";
import { useTabSearch } from "~/hooks/useTabSearch";
import { useFilterSearch } from "~/hooks/useSearchState";

/** The tabs, in the order they are shown; the first is the default. */
export const CLUSTER_TABS = ["services", "tasks", "stopped", "instances"] as const;

type Tab = (typeof CLUSTER_TABS)[number];

/** One cluster: its services, its tasks (running and stopped), its EC2 fleet. */
export function ClusterPage({ cluster }: { cluster: string }) {
  const scope = useAwsScope();
  const [tab, setTab] = useTabSearch(CLUSTER_TABS, "services");
  const [filter, setFilter] = useFilterSearch();

  // The cluster, not the tab: which of its four lists you last had open is a
  // view onto the same place, and remembering four of them would fill the rail
  // with one cluster.
  const target = React.useMemo<ResourceRef>(
    () => ({
      kind: "ecs-cluster",
      id: cluster,
      label: cluster,
      detail: "cluster",
      scope: { profile: scope.profile, region: scope.region, connectionId: "" },
      to: `/ecs/clusters/${encodeURIComponent(cluster)}`,
    }),
    [cluster, scope.profile, scope.region],
  );
  useRecordVisit(target);

  const services = useQuery({
    ...trpc.ecs.services.queryOptions({ ...scope, cluster }),
    enabled: tab === "services",
  });
  const tasks = useQuery({
    ...trpc.ecs.tasks.queryOptions({ ...scope, cluster, desiredStatus: "RUNNING" }),
    enabled: tab === "tasks",
  });
  const stopped = useQuery({
    ...trpc.ecs.tasks.queryOptions({ ...scope, cluster, desiredStatus: "STOPPED" }),
    enabled: tab === "stopped",
  });
  const instances = useQuery({
    ...trpc.ecs.containerInstances.queryOptions({ ...scope, cluster }),
    enabled: tab === "instances",
  });

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>{cluster}</PanelTitle>
        <Segmented<Tab>
          value={tab}
          onChange={(next) => {
            // A filter written for one tab's columns is meaningless in the
            // next, so switching tabs clears it.
            setTab(next);
            setFilter("");
          }}
          options={[
            { value: "services", label: "Services", count: services.data?.length },
            { value: "tasks", label: "Tasks", count: tasks.data?.length },
            { value: "stopped", label: "Stopped", count: stopped.data?.length },
            { value: "instances", label: "EC2", count: instances.data?.length },
          ]}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <FilterInput value={filter} onChange={setFilter} />
          <PinButton target={target} />
        </div>
      </PanelHeader>

      {tab === "services" ? (
        <ServicesTable cluster={cluster} query={services} filter={filter} />
      ) : null}
      {tab === "tasks" ? (
        <TasksTable cluster={cluster} query={tasks} filter={filter} emptyLabel="No running tasks" />
      ) : null}
      {tab === "stopped" ? (
        <TasksTable
          cluster={cluster}
          query={stopped}
          filter={filter}
          emptyLabel="No stopped tasks in the retention window"
        />
      ) : null}
      {tab === "instances" ? <InstancesTable query={instances} filter={filter} /> : null}
    </Panel>
  );
}

type QueryLike<T> = {
  data: T[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

function ServicesTable({
  cluster,
  query,
  filter,
}: {
  cluster: string;
  query: QueryLike<EcsService>;
  filter: string;
}) {
  const [, setFilter] = useFilterSearch();
  const navigate = useNavigate();
  const dismissed = useSilenced((state) => state.dismissed);
  const muted = useSilenced((state) => state.muted);

  const columns = React.useMemo<Column<EcsService>[]>(
    () => [
      {
        id: "name",
        header: "Service",
        value: (row) => row.name,
        cell: (row) => {
          const tone = serviceTone(row.deploymentState);
          return (
            <span className="flex items-center gap-2">
              <StatusDot tone={tone.tone} pulse={tone.pulse} />
              <span className="font-medium">{row.name}</span>
            </span>
          );
        },
      },
      {
        id: "state",
        header: "State",
        width: "8.5rem",
        value: (row) => row.deploymentState,
        cell: (row) => {
          const tone = serviceTone(row.deploymentState);
          return <Badge tone={tone.tone === "neutral" ? "neutral" : tone.tone}>{tone.label}</Badge>;
        },
      },
      {
        id: "tasks",
        header: "Tasks",
        width: "9rem",
        value: (row) => row.runningCount,
        cell: (row) => (
          <CountMeter
            running={row.runningCount}
            desired={row.desiredCount}
            pending={row.pendingCount}
          />
        ),
      },
      { id: "taskdef", header: "Task definition", value: (row) => row.taskDefinition, mono: true },
      {
        id: "launch",
        header: "Launch",
        width: "7rem",
        value: (row) => row.launchType ?? "-",
        cell: (row) => <Badge>{row.launchType ?? "provider"}</Badge>,
      },
      {
        id: "exec",
        header: "Exec",
        width: "5.5rem",
        value: (row) => (row.enableExecuteCommand ? "on" : "off"),
        cell: (row) =>
          row.enableExecuteCommand ? (
            <Badge tone="info">on</Badge>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
      },
      {
        // "When did this last change?" is the first question about a service
        // you didn't deploy yourself.
        id: "deployed",
        header: "Deployed",
        width: "8.5rem",
        align: "right",
        mono: true,
        value: (row) => row.lastDeploymentAt ?? "",
        cell: (row) => (
          <span className="text-muted-foreground">{relativeTime(row.lastDeploymentAt)}</span>
        ),
      },
      {
        id: "uptime",
        header: "Stable for",
        width: "8.5rem",
        align: "right",
        mono: true,
        value: (row) => row.steadySince ?? "",
        cell: (row) =>
          row.steadySince ? (
            <span className="text-muted-foreground">{uptimeLabel(row.steadySince)}</span>
          ) : (
            <span className="text-warning">in flight</span>
          ),
      },
      {
        id: "failures",
        header: "Failures",
        width: "7rem",
        align: "right",
        value: (row) => row.failedTasks,
        cell: (row) => <FailureCell service={row} />,
      },
    ],
    [],
  );

  if (query.isPending) return <LoadingRows />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const rows = query.data ?? [];
  const troubled = partitionSilenced(
    { dismissed, muted },
    rows.filter(
      (row) =>
        row.failedTasks > 0 || row.rolloutState === "FAILED" || row.deploymentState === "degraded",
    ),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {troubled.visible.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-danger/30 bg-danger/8 px-3.5 py-2">
          <AlertTriangle className="size-3.5 shrink-0 text-danger" strokeWidth={1.9} />
          <span className="text-[12px] text-danger">
            {troubled.visible.length} service{troubled.visible.length === 1 ? "" : "s"} needing
            attention:
          </span>
          {troubled.visible.slice(0, 6).map((row) => (
            <span
              key={row.arn}
              className="flex items-center gap-1 rounded bg-danger/12 py-0.5 pr-0.5 pl-1.5"
            >
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/ecs/clusters/$cluster/services/$service",
                    params: { cluster, service: row.name },
                  })
                }
                className="cursor-pointer font-mono text-[11px] text-danger"
              >
                {row.name}
              </button>
              <SilenceMenu service={row} />
            </span>
          ))}
          {troubled.visible.length > 6 ? (
            <span className="font-mono text-[11px] text-danger/80">
              +{troubled.visible.length - 6} more
            </span>
          ) : null}
          <div className="ml-auto">
            <HiddenCount
              count={troubled.hidden.length}
              revealed={false}
              onReveal={() => void navigate({ to: "/settings" })}
            />
          </div>
        </div>
      ) : troubled.hidden.length > 0 ? (
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-1.5">
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {troubled.hidden.length} silenced warning{troubled.hidden.length === 1 ? "" : "s"} in
            this cluster
          </span>
          <TextAction onClick={() => void navigate({ to: "/settings" })}>manage</TextAction>
        </div>
      ) : null}

      <DataTable
        tableId="ecs-cluster-services"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.arn}
        filter={filter}
        onClearFilter={() => setFilter("")}
        onOpen={(row) =>
          void navigate({
            to: "/ecs/clusters/$cluster/services/$service",
            params: { cluster, service: row.name },
          })
        }
        emptyState={<EmptyState icon={Boxes} title="No services in this cluster" />}
      />
    </div>
  );
}

/**
 * A failure count alone doesn't say whether it is happening now. A settled
 * FAILED rollout still matters — that is the deploy that quietly reverted.
 */
function FailureCell({ service }: { service: EcsService }) {
  const silence = useServiceSilence(service);
  const hasFailure = service.rolloutState === "FAILED" || service.failedTasks > 0;
  if (!hasFailure) return <span className="text-muted-foreground/50">—</span>;

  const label =
    service.rolloutState === "FAILED" ? "rollout failed" : `${service.failedTasks} failed`;

  // Silenced failures stay visible in the table - the row is the place you
  // went looking. Only the alarm-level surfaces drop them.
  if (silence.silenced) {
    return (
      <span
        title={`${label} · ${silence.reason === "muted" ? "service muted" : "dismissed"} — manage in Settings`}
        className="font-mono text-[10.5px] text-muted-foreground/60 line-through"
      >
        {label}
      </span>
    );
  }

  return (
    <span title={service.rolloutStateReason ?? undefined}>
      <Badge tone={service.rolloutState === "FAILED" ? "danger" : "warning"}>{label}</Badge>
    </span>
  );
}

function TasksTable({
  cluster,
  query,
  filter,
  emptyLabel,
}: {
  cluster: string;
  query: QueryLike<EcsTask>;
  filter: string;
  emptyLabel: string;
}) {
  const [, setFilter] = useFilterSearch();
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
              <span className="font-mono text-[11.5px]">{row.id}</span>
            </span>
          );
        },
      },
      { id: "service", header: "Service", value: (row) => row.serviceName ?? "-" },
      { id: "status", header: "Status", width: "8rem", value: (row) => row.lastStatus, mono: true },
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
      { id: "taskdef", header: "Task definition", value: (row) => row.taskDefinition, mono: true },
      {
        id: "cpu",
        header: "CPU",
        width: "6.5rem",
        align: "right",
        mono: true,
        value: (row) => row.cpu ?? "",
        cell: (row) => cpuLabel(row.cpu),
      },
      {
        id: "mem",
        header: "Memory",
        width: "7rem",
        align: "right",
        mono: true,
        value: (row) => row.memory ?? "",
        cell: (row) => memoryLabel(row.memory),
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
        cell: (row) => (
          <span className="text-muted-foreground">
            {relativeTime(row.stoppedAt ?? row.startedAt)}
          </span>
        ),
      },
      {
        // Opens this task's output below the table. For a stopped task this is
        // usually the only remaining evidence of why it stopped.
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
        tableId="ecs-cluster-tasks"
        rows={query.data ?? []}
        columns={columns}
        rowKey={(row) => row.arn}
        filter={filter}
        onClearFilter={() => setFilter("")}
        onOpen={(row) =>
          void navigate({
            to: "/ecs/clusters/$cluster/tasks/$taskId",
            params: { cluster, taskId: row.id },
          })
        }
        emptyState={<EmptyState icon={Cpu} title={emptyLabel} />}
      />
      {logsFor ? <TaskLogsDrawer task={logsFor} onClose={() => setLogsFor(null)} /> : null}
    </div>
  );
}

function InstancesTable({
  query,
  filter,
}: {
  query: QueryLike<EcsContainerInstance>;
  filter: string;
}) {
  const [, setFilter] = useFilterSearch();
  const scope = useAwsScope();
  const openSession = useSessions((state) => state.open);
  const columns = React.useMemo<Column<EcsContainerInstance>[]>(
    () => [
      {
        id: "instance",
        header: "Instance",
        value: (row) => row.ec2InstanceId ?? row.id,
        cell: (row) => (
          <span className="flex items-center gap-2">
            <StatusDot
              tone={row.agentConnected && row.status === "ACTIVE" ? "success" : "danger"}
            />
            <span className="font-mono text-[11.5px]">{row.ec2InstanceId ?? row.id}</span>
          </span>
        ),
      },
      { id: "status", header: "Status", width: "8rem", value: (row) => row.status, mono: true },
      {
        id: "agent",
        header: "Agent",
        width: "8rem",
        value: (row) => row.agentVersion ?? "-",
        cell: (row) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.agentConnected ? (row.agentVersion ?? "connected") : "disconnected"}
          </span>
        ),
      },
      {
        id: "running",
        header: "Running",
        width: "7rem",
        align: "right",
        mono: true,
        value: (row) => row.runningTasks,
      },
      {
        id: "pending",
        header: "Pending",
        width: "7rem",
        align: "right",
        mono: true,
        value: (row) => row.pendingTasks,
      },
      {
        id: "cpu",
        header: "CPU free",
        width: "9rem",
        align: "right",
        value: (row) => row.remainingCpu ?? 0,
        cell: (row) => (
          <CountMeter
            className="justify-end"
            running={(row.registeredCpu ?? 0) - (row.remainingCpu ?? 0)}
            desired={row.registeredCpu ?? 0}
          />
        ),
      },
      {
        id: "mem",
        header: "Memory free",
        width: "9.5rem",
        align: "right",
        value: (row) => row.remainingMemory ?? 0,
        cell: (row) => (
          <CountMeter
            className="justify-end"
            running={(row.registeredMemory ?? 0) - (row.remainingMemory ?? 0)}
            desired={row.registeredMemory ?? 0}
          />
        ),
      },
      {
        id: "provider",
        header: "Capacity provider",
        value: (row) => row.capacityProvider ?? "-",
        mono: true,
      },
      {
        id: "shell",
        header: "",
        align: "right",
        value: (row) => row.ec2InstanceId ?? "",
        cell: (row) =>
          row.ec2InstanceId ? (
            <Button
              // Session Manager rather than SSH: a container instance is
              // reachable by agent whether or not it has a public address or a
              // key pair, and this table already knows the agent is connected.
              onClick={() =>
                openSession({
                  kind: "ssm",
                  profile: scope.profile,
                  region: scope.region,
                  instanceId: row.ec2InstanceId ?? "",
                })
              }
              disabled={!row.agentConnected}
              title={
                row.agentConnected
                  ? `Open a Session Manager shell on ${row.ec2InstanceId}`
                  : "The ECS agent on this instance is not connected"
              }
            >
              <TerminalSquare className="size-3" /> Shell
            </Button>
          ) : null,
      },
    ],
    [openSession, scope.profile, scope.region],
  );

  if (query.isPending) return <LoadingRows />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <DataTable
      tableId="ecs-container-instances"
      rows={query.data ?? []}
      columns={columns}
      rowKey={(row) => row.arn}
      filter={filter}
      onClearFilter={() => setFilter("")}
      emptyState={
        <EmptyState
          icon={Server}
          title="No registered EC2 instances"
          hint="Fargate-only clusters have no container instances."
        />
      }
    />
  );
}
