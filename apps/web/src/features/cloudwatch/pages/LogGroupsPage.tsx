import { type LogGroup, MAX_TAILED_GROUPS } from "@faws/contracts";
import { byteSize, relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Layers, ScrollText } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { pinColumn } from "~/components/PinButton";
import { FilterInput } from "~/components/toolbar";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { retentionLabel } from "~/features/cloudwatch/metric-ref";
import { logGroupRef } from "~/features/cloudwatch/refs";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { useFilterSearch, useSelectionSearch } from "~/hooks/useSearchState";

/**
 * Every log group in the scoped region.
 *
 * Ticking groups is how several are tailed together: the ticks ride in the
 * URL like the filter does, and the button hands them to the tail page.
 * Group names cannot contain a comma, so the comma-joined selection param
 * carries them safely.
 */
export function LogGroupsPage() {
  const scope = useAwsScope();
  const navigate = useNavigate();
  const [filter, setFilter] = useFilterSearch();
  const [selected, setSelected] = useSelectionSearch();
  const tooMany = selected.size > MAX_TAILED_GROUPS;

  const groups = useQuery(trpc.cloudwatch.logGroups.queryOptions(scope));
  const rows = groups.data?.groups ?? [];

  const columns = React.useMemo<Column<LogGroup>[]>(
    () => [
      {
        id: "name",
        header: "Log group",
        value: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      {
        id: "retention",
        header: "Retention",
        width: "9rem",
        // Sorted by days, with "never" after the longest finite retention.
        value: (row) => row.retentionDays ?? Number.MAX_SAFE_INTEGER,
        cell: (row) => (
          <span className={row.retentionDays === null ? "text-warning" : "text-muted-foreground"}>
            {retentionLabel(row.retentionDays)}
          </span>
        ),
      },
      {
        id: "stored",
        header: "Stored",
        width: "8rem",
        align: "right",
        mono: true,
        value: (row) => row.storedBytes ?? 0,
        cell: (row) => (row.storedBytes === null ? "-" : byteSize(row.storedBytes)),
      },
      {
        id: "class",
        header: "Class",
        width: "10rem",
        mono: true,
        defaultHidden: true,
        value: (row) => row.logClass ?? "",
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
      pinColumn((row) => logGroupRef(row.name, scope)),
    ],
    [scope],
  );

  if (groups.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Log groups</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {groups.isPending ? "…" : rows.length}
        </span>
        {groups.data?.truncated ? (
          <span
            className="font-mono text-[10.5px] whitespace-nowrap text-warning"
            title="This region has more log groups than one listing covers."
          >
            first {rows.length} only
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant={selected.size > 0 ? "default" : "outline"}
            disabled={selected.size === 0 || tooMany}
            title={
              selected.size === 0
                ? "Tick log groups to tail them together"
                : tooMany
                  ? `At most ${MAX_TAILED_GROUPS} groups are tailed at once`
                  : "Tail the ticked groups together"
            }
            onClick={() =>
              void navigate({
                to: "/cloudwatch/tail",
                search: { groups: [...selected].toSorted() },
              })
            }
          >
            <Layers className="size-3" />
            {selected.size > 0 ? `Tail ${selected.size} together` : "Tail together"}
          </Button>
          <FilterInput value={filter} onChange={setFilter} total={rows.length} />
        </div>
      </PanelHeader>

      {groups.isPending ? (
        <LoadingRows />
      ) : (
        <DataTable
          tableId="cloudwatch-log-groups"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.name}
          filter={filter}
          onClearFilter={() => setFilter("")}
          selection={{ selected, onChange: setSelected }}
          onOpen={(row) =>
            void navigate({ to: "/cloudwatch/log-groups/$group", params: { group: row.name } })
          }
          emptyState={
            <EmptyState
              icon={ScrollText}
              title="No log groups"
              hint="This region has no log groups, or the profile cannot list them."
            />
          }
        />
      )}
    </Panel>
  );
}
