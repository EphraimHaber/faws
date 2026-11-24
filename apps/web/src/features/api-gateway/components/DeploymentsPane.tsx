import type { RestApiDeployment } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/stores/scope";
import { TruncatedNote } from "~/features/api-gateway/components/parts";
import { stagesByDeployment } from "~/features/api-gateway/stages";
import { withoutListSearch } from "~/hooks/useSearchState";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";

/** Every deployment of the API, newest first, with the stages serving each. */
export function DeploymentsPane({ apiId }: { apiId: string }) {
  const scope = useAwsScope();
  const deployments = useQuery(trpc.apiGateway.deployments.queryOptions({ ...scope, apiId }));
  const stages = useQuery(trpc.apiGateway.stages.queryOptions({ ...scope, apiId }));
  const uses = React.useMemo(() => stagesByDeployment(stages.data ?? []), [stages.data]);

  const columns = React.useMemo<Column<RestApiDeployment>[]>(
    () => [
      {
        id: "id",
        header: "Deployment",
        width: "9rem",
        mono: true,
        value: (row) => row.id,
      },
      {
        id: "stages",
        header: "Stages",
        width: "14rem",
        value: (row) =>
          (uses.get(row.id) ?? []).map((use) => use.stage).join(", ") ||
          (stages.isPending ? "…" : ""),
        cell: (row) => {
          const list = uses.get(row.id) ?? [];
          if (list.length === 0) {
            return <span className="text-muted-foreground">{stages.isPending ? "…" : "-"}</span>;
          }
          return (
            <span className="flex flex-wrap gap-1">
              {list.map((use) => (
                <Link
                  key={`${use.stage} ${use.canary}`}
                  to="/api-gateway/rest-apis/$apiId"
                  params={{ apiId }}
                  search={(prev) => ({
                    ...withoutListSearch(prev),
                    tab: "stages",
                    stage: use.stage,
                  })}
                  title={use.canary ? `Canary of ${use.stage}` : `Served on ${use.stage}`}
                >
                  <Badge tone={use.canary ? "info" : "success"}>
                    {use.stage}
                    {use.canary ? " · canary" : ""}
                  </Badge>
                </Link>
              ))}
            </span>
          );
        },
      },
      {
        id: "description",
        header: "Description",
        value: (row) => row.description ?? "",
        cell: (row) => <span className="text-muted-foreground">{row.description ?? "-"}</span>,
      },
      {
        id: "created",
        header: "Created",
        width: "14rem",
        defaultHidden: true,
        value: (row) => row.createdAt ?? "",
        cell: (row) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {fullTimestamp(row.createdAt)}
          </span>
        ),
      },
      {
        id: "age",
        header: "Age",
        width: "8rem",
        align: "right",
        mono: true,
        value: (row) => row.createdAt ?? "",
        cell: (row) => (
          <span className="text-muted-foreground" title={fullTimestamp(row.createdAt)}>
            {relativeTime(row.createdAt)}
          </span>
        ),
      },
    ],
    [apiId, uses, stages.isPending],
  );

  if (deployments.isPending) return <LoadingRows />;
  if (deployments.isError) {
    return <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {deployments.data.truncated ? (
        <TruncatedNote
          count={deployments.data.deployments.length}
          noun="deployments"
          place="banner"
        />
      ) : null}
      {stages.isError ? (
        <p className="border-b border-border px-3 py-1.5 font-mono text-[10.5px] text-warning">
          stages could not be read, so which deployment each serves is unknown
        </p>
      ) : null}
      <DataTable
        tableId="api-gateway-deployments"
        rows={deployments.data.deployments}
        columns={columns}
        rowKey={(row) => row.id}
        emptyState={
          <EmptyState
            icon={History}
            title="This API has never been deployed"
            hint="A deployment is a snapshot of the API that a stage serves."
          />
        }
      />
    </div>
  );
}
