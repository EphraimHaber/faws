import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { StatusDot } from "~/components/ui/status-dot";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import type { EcsCluster } from "@faws/contracts";
import { useFilterSearch } from "~/hooks/useSearchState";

/** Entry point of the drill-down: every cluster in the region, with the four
 *  counts that decide where you go next. */
export function ClustersPage() {
  const scope = useAwsScope();
  const navigate = useNavigate();
  const [filter, setFilter] = useFilterSearch();

  const clusters = useQuery(trpc.ecs.clusters.queryOptions(scope));
  const rows = clusters.data ?? [];

  const columns = React.useMemo<Column<EcsCluster>[]>(
    () => [
      {
        id: "name",
        header: "Cluster",
        value: (row) => row.name,
        cell: (row) => (
          <span className="flex items-center gap-2">
            <StatusDot
              tone={row.status === "ACTIVE" ? "success" : "neutral"}
              pulse={row.pendingTasks > 0}
            />
            <span className="truncate font-medium">{row.name}</span>
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        width: "8rem",
        value: (row) => row.status,
        cell: (row) => (
          <Badge tone={row.status === "ACTIVE" ? "success" : "neutral"}>{row.status}</Badge>
        ),
      },
      {
        id: "services",
        header: "Services",
        width: "7rem",
        align: "right",
        mono: true,
        value: (row) => row.activeServices,
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
        cell: (row) => (
          <span className={row.pendingTasks > 0 ? "text-warning" : "text-muted-foreground"}>
            {row.pendingTasks}
          </span>
        ),
      },
      {
        id: "instances",
        header: "EC2",
        width: "6rem",
        align: "right",
        mono: true,
        value: (row) => row.registeredInstances,
      },
      {
        id: "providers",
        header: "Capacity providers",
        value: (row) => row.capacityProviders.join(", "),
        cell: (row) => (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {row.capacityProviders.join(" · ") || "-"}
          </span>
        ),
      },
      {
        id: "insights",
        header: "Insights",
        width: "6.5rem",
        value: (row) => (row.containerInsights ? "on" : "off"),
        cell: (row) => (row.containerInsights ? <Badge tone="info">on</Badge> : <Badge>off</Badge>),
      },
    ],
    [],
  );

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Clusters</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {clusters.isPending ? "…" : rows.length}
        </span>
        <div className="ml-auto">
          <FilterInput value={filter} onChange={setFilter} total={rows.length} />
        </div>
      </PanelHeader>

      {clusters.isPending ? <LoadingRows /> : null}
      {clusters.isError ? (
        <ErrorState error={clusters.error} onRetry={() => void clusters.refetch()} />
      ) : null}
      {clusters.isSuccess ? (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.arn}
          filter={filter}
          onOpen={(row) =>
            void navigate({ to: "/ecs/clusters/$cluster", params: { cluster: row.name } })
          }
          emptyState={
            <EmptyState
              icon={Layers}
              title="No ECS clusters in this region"
              hint="Switch region with Ctrl+R, or pick another profile with Ctrl+P."
            />
          }
        />
      ) : null}
    </Panel>
  );
}
