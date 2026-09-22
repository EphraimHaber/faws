import type { EcsService } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Rocket } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { CountMeter } from "~/components/meter";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { StatusDot } from "~/components/ui/status-dot";
import { useAwsScope } from "~/contexts/ScopeContext";
import { serviceTone } from "~/lib/status";
import { trpc } from "~/lib/trpc";
import { useFilterSearch } from "~/hooks/useSearchState";

/**
 * Every service in the region that has ever rolled out, newest first.
 *
 * The overview's "Recently deployed" panel answers "what moved lately" for the
 * top handful; this is the same question without a ceiling, and with the
 * rollout columns a panel row has no width for.
 */
export function DeploymentsPage() {
  const scope = useAwsScope();
  const navigate = useNavigate();
  const [filter, setFilter] = useFilterSearch();

  const clusters = useQuery(trpc.ecs.clusters.queryOptions(scope));
  const clusterList = React.useMemo(() => clusters.data ?? [], [clusters.data]);

  // Deployments are a per-service fact, and ECS only lists services per
  // cluster, so a region-wide view is one query per cluster. They run in
  // parallel and share the cache the overview and cluster pages already fill.
  const serviceQueries = useQueries({
    queries: clusterList.map((cluster) =>
      trpc.ecs.services.queryOptions({ ...scope, cluster: cluster.name }),
    ),
  });

  const loadingServices = serviceQueries.some((query) => query.isPending);
  const rows = React.useMemo(
    () =>
      serviceQueries
        .flatMap((query) => query.data ?? [])
        .filter((service) => service.lastDeploymentAt)
        .toSorted((a, b) => (b.lastDeploymentAt ?? "").localeCompare(a.lastDeploymentAt ?? "")),
    [serviceQueries],
  );

  const columns = React.useMemo<Column<EcsService>[]>(
    () => [
      {
        id: "service",
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
        id: "cluster",
        header: "Cluster",
        width: "12rem",
        mono: true,
        value: (row) => row.clusterName,
      },
      {
        id: "revision",
        header: "Revision",
        width: "14rem",
        mono: true,
        value: (row) => `${row.taskDefinitionFamily}:${row.taskDefinitionRevision}`,
      },
      {
        id: "rollout",
        header: "Rollout",
        width: "9rem",
        value: (row) => row.rolloutState ?? row.deploymentState,
        cell: (row) =>
          row.rolloutState === "FAILED" ? (
            <Badge tone="danger">failed</Badge>
          ) : row.deploymentState === "deploying" ? (
            <Badge tone="info">deploying</Badge>
          ) : row.deploymentState === "degraded" ? (
            <Badge tone="warning">degraded</Badge>
          ) : (
            <Badge tone="success">{row.rolloutState?.toLowerCase() ?? "steady"}</Badge>
          ),
      },
      {
        id: "tasks",
        header: "Tasks",
        width: "8rem",
        value: (row) => `${row.runningCount}/${row.desiredCount}`,
        cell: (row) => (
          <CountMeter
            running={row.runningCount}
            desired={row.desiredCount}
            pending={row.pendingCount}
          />
        ),
      },
      {
        id: "failed",
        header: "Failed",
        width: "6rem",
        align: "right",
        mono: true,
        value: (row) => row.failedTasks,
        cell: (row) => (
          <span className={row.failedTasks > 0 ? "text-danger" : "text-muted-foreground"}>
            {row.failedTasks}
          </span>
        ),
      },
      {
        id: "deployed",
        header: "Deployed",
        width: "9rem",
        align: "right",
        mono: true,
        // Sorting on the raw timestamp keeps "3m" above "2h"; the cell shows
        // the human form.
        value: (row) => row.lastDeploymentAt ?? "",
        cell: (row) => (
          <span className="text-muted-foreground" title={row.lastDeploymentAt ?? undefined}>
            {relativeTime(row.lastDeploymentAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (clusters.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={clusters.error} onRetry={() => void clusters.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Recently deployed</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {loadingServices ? "…" : rows.length}
        </span>
        <div className="ml-auto">
          <FilterInput value={filter} onChange={setFilter} total={rows.length} />
        </div>
      </PanelHeader>

      {loadingServices && rows.length === 0 ? (
        <LoadingRows />
      ) : (
        <DataTable
          tableId="ecs-deployments"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.arn}
          filter={filter}
          onClearFilter={() => setFilter("")}
          onOpen={(row) =>
            void navigate({
              to: "/ecs/clusters/$cluster/services/$service",
              params: { cluster: row.clusterName, service: row.name },
            })
          }
          emptyState={
            <EmptyState
              icon={Rocket}
              title="Nothing has deployed in this region"
              hint="Switch region with Ctrl+R, or pick another profile with Ctrl+P."
            />
          }
        />
      )}
    </Panel>
  );
}
