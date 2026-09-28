import type { RestApiSummary } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { pinColumn } from "~/components/PinButton";
import { FilterInput } from "~/components/toolbar";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { restApiRef } from "~/features/api-gateway/refs";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { useFilterSearch } from "~/hooks/useSearchState";

/** Every REST API in the scoped region. */
export function RestApisPage() {
  const scope = useAwsScope();
  const [filter, setFilter] = useFilterSearch();

  const apis = useQuery(trpc.apiGateway.restApis.queryOptions(scope));
  const rows = apis.data?.apis ?? [];

  const columns = React.useMemo<Column<RestApiSummary>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        value: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      {
        id: "id",
        header: "API id",
        width: "9rem",
        mono: true,
        value: (row) => row.id,
      },
      {
        id: "endpoint",
        header: "Endpoint",
        width: "8rem",
        mono: true,
        value: (row) => row.endpointTypes.join(", "),
        cell: (row) => (row.endpointTypes.length === 0 ? "-" : row.endpointTypes.join(", ")),
      },
      {
        id: "description",
        header: "Description",
        value: (row) => row.description ?? "",
        cell: (row) => <span className="text-muted-foreground">{row.description ?? "-"}</span>,
      },
      {
        id: "key-source",
        header: "API key source",
        width: "9rem",
        mono: true,
        value: (row) => row.apiKeySource ?? "",
        cell: (row) => row.apiKeySource ?? "-",
      },
      {
        id: "version",
        header: "Version",
        width: "8rem",
        mono: true,
        defaultHidden: true,
        value: (row) => row.version ?? "",
        cell: (row) => row.version ?? "-",
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
        cell: (row) => <span className="text-muted-foreground">{relativeTime(row.createdAt)}</span>,
      },
      pinColumn((row) => restApiRef(row, scope)),
    ],
    [scope],
  );

  if (apis.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={apis.error} onRetry={() => void apis.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>REST APIs</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {apis.isPending ? "…" : rows.length}
        </span>
        {apis.data?.truncated ? (
          <span
            className="font-mono text-[10.5px] whitespace-nowrap text-warning"
            title="This region has more REST APIs than one listing covers."
          >
            first {rows.length} only
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <FilterInput value={filter} onChange={setFilter} total={rows.length} />
        </div>
      </PanelHeader>

      {apis.isPending ? (
        <LoadingRows />
      ) : (
        <DataTable
          tableId="api-gateway-rest-apis"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          filter={filter}
          onClearFilter={() => setFilter("")}
          emptyState={
            <EmptyState
              icon={Network}
              title="No REST APIs"
              hint="This region has no REST APIs, or the profile cannot list them."
            />
          }
        />
      )}
    </Panel>
  );
}
