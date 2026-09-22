import type { ExecInstanceTarget } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Server, TerminalSquare } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { useFilterSearch } from "~/hooks/useSearchState";
import { instanceActions, instanceRef } from "~/lib/terminal/connectable";
import { trpc } from "~/lib/trpc";
import type { ExecTarget } from "~/lib/terminal/handshake";
import { recentActions } from "~/stores/recents";
import { useSessions } from "~/stores/sessions";

/**
 * EC2 instances, listed for one reason: getting a shell on one.
 *
 * So the columns are the ones that decide whether that will work - whether SSM
 * can reach it, whether it has an address, which login its AMI ships with -
 * rather than a general-purpose inventory. An instance nothing can reach says
 * so plainly instead of offering a button that cannot succeed.
 *
 * It is a `DataTable`, like every other list in the app, rather than a flex
 * row per instance, for three things the shared table gives away: headers, so
 * the columns are named at all; a fixed grid, so a row with two addresses or a
 * wider badge does not shove every cell after it out of line with the rows
 * above; and sorting plus `column:value` filtering. Thirty rows of unlabelled,
 * unaligned columns is not something anyone can read down.
 */
export function InstancesPage() {
  const scope = useAwsScope();
  const open = useSessions((state) => state.open);
  const [filter, setFilter] = useFilterSearch();
  const targets = useQuery(trpc.exec.targets.queryOptions(scope));
  const rows = targets.data ?? [];

  const columns = React.useMemo<Column<ExecInstanceTarget>[]>(
    () => [
      {
        id: "name",
        header: "Instance",
        value: (row) => `${row.name ?? ""} ${row.instanceId}`,
        cell: (row) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px]">{row.name ?? row.instanceId}</span>
            <span className="truncate font-mono text-[10.5px] text-muted-foreground">
              {row.instanceId}
            </span>
          </span>
        ),
      },
      {
        id: "address",
        header: "Address",
        width: "11rem",
        // The private address sorts and filters; a public one is shown under it
        // rather than beside it, because an instance with both is reachable two
        // ways and which one you get is the difference between the buttons.
        value: (row) => row.privateIp ?? "",
        cell: (row) => (
          <span className="flex min-w-0 flex-col font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{row.privateIp ?? "-"}</span>
            {row.publicIp ? <span className="truncate">{row.publicIp}</span> : null}
          </span>
        ),
      },
      {
        id: "type",
        header: "Type",
        width: "9rem",
        value: (row) => row.instanceType ?? "",
        cell: (row) => (
          <span className="flex min-w-0 flex-col text-[11px] text-muted-foreground">
            <span className="truncate">{row.instanceType ?? "-"}</span>
            <span className="truncate">{row.availabilityZone ?? "-"}</span>
          </span>
        ),
      },
      {
        id: "state",
        header: "State",
        width: "6.5rem",
        value: (row) => row.state,
        cell: (row) => (
          <Badge tone={row.state === "running" ? "success" : "neutral"}>{row.state}</Badge>
        ),
      },
      {
        id: "ssm",
        header: "SSM",
        width: "7rem",
        value: (row) => (row.ssmManaged ? (row.ssmPingStatus ?? "managed") : ""),
        cell: (row) =>
          row.ssmManaged ? (
            <Badge tone={row.ssmPingStatus === "Online" ? "info" : "warning"}>
              {row.ssmPingStatus?.toLowerCase() ?? "?"}
            </Badge>
          ) : (
            <span className="font-mono text-[10.5px] text-muted-foreground/50">-</span>
          ),
      },
      {
        id: "shell",
        header: "Shell",
        width: "15rem",
        align: "right",
        // Sortable and filterable by how it can be reached, which is the one
        // question this page exists to answer: `shell:unreachable` lists every
        // instance you cannot get onto.
        value: (row) => (row.reachableBy.length === 0 ? "unreachable" : row.reachableBy.join(" ")),
        cell: (row) => <Connect row={row} scope={scope} onOpen={open} />,
      },
    ],
    [open, scope],
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Panel className="min-h-0 flex-1">
        <PanelHeader>
          <PanelTitle>Instances</PanelTitle>
          <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
          <div className="ml-auto">
            <FilterInput
              value={filter}
              onChange={setFilter}
              total={rows.length}
              placeholder="Filter… (try type:t3)"
            />
          </div>
        </PanelHeader>

        {targets.isPending ? (
          <LoadingRows rows={10} />
        ) : targets.isError ? (
          <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.instanceId}
            filter={filter}
            emptyState={
              <EmptyState
                icon={Server}
                title="No instances"
                hint={`Nothing running in ${scope.region}`}
              />
            }
          />
        )}
      </Panel>
    </div>
  );
}

/** One way onto an instance: what to call it, why, and what to open. */

/**
 * The ways onto this instance, best first.
 *
 * Every one of them is a button of the same shape. They were a bordered
 * "Shell" beside a borderless "SSH via SSM", which made two equally real
 * actions look like a control and a caption - and put the second one in a
 * different place on every row, since its width depended on the first.
 *
 * An instance nothing can reach still says so in plain text, deliberately:
 * there the point *is* that there is nothing to press.
 */
function Connect({
  row,
  scope,
  onOpen,
}: {
  row: ExecInstanceTarget;
  scope: { profile: string; region: string };
  onOpen: (target: ExecTarget) => string;
}) {
  const routes = instanceActions(row, scope);

  if (routes.length === 0) {
    return (
      <span
        className="font-mono text-[10.5px] text-muted-foreground/70"
        title="No SSM agent, and no address to reach it at"
      >
        unreachable
      </span>
    );
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      {routes.map((route, index) => (
        <Button
          key={route.label}
          size="sm"
          // The first is the one to reach for; the rest are what you try when
          // it does not work. Both are buttons either way.
          variant={index === 0 ? "default" : "outline"}
          title={route.title}
          onClick={() => {
            // Recorded on the shell rather than on a dwell, because this list
            // has no per-instance page to sit on: what makes an instance worth
            // remembering is that you got onto it.
            recentActions.record(instanceRef(row, scope));
            onOpen(route.target);
          }}
        >
          {index === 0 ? <TerminalSquare className="size-3" /> : null}
          {route.label}
        </Button>
      ))}
    </span>
  );
}
