import type { S3Bucket } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Database } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { FilterInput } from "~/components/toolbar";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useS3Scope } from "~/contexts/ScopeContext";
import { ConnectionPicker } from "~/features/s3/components/ConnectionPicker";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";

/**
 * Every bucket in the account.
 *
 * There is no region column: buckets are listed account wide, and the home
 * region of each one is a separate call per bucket, which on an account with
 * hundreds of them is a slower page than the list it would be decorating. The
 * region is resolved when a bucket is opened, where it is actually needed.
 */
export function BucketsPage() {
  const scope = useS3Scope();
  const navigate = useNavigate();
  const [filter, setFilter] = React.useState("");

  const buckets = useQuery(trpc.s3.buckets.queryOptions(scope));
  const rows = buckets.data ?? [];

  const columns = React.useMemo<Column<S3Bucket>[]>(
    () => [
      {
        id: "name",
        header: "Bucket",
        value: (row) => row.name,
        cell: (row) => (
          <span className="flex items-center gap-2">
            <Database className="size-3.5 text-muted-foreground" strokeWidth={1.7} />
            <span className="truncate font-medium">{row.name}</span>
          </span>
        ),
      },
      {
        id: "created",
        header: "Created",
        width: "14rem",
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
        width: "9rem",
        align: "right",
        mono: true,
        value: (row) => row.createdAt ?? "",
        cell: (row) => <span className="text-muted-foreground">{relativeTime(row.createdAt)}</span>,
      },
    ],
    [],
  );

  if (buckets.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={buckets.error} onRetry={() => void buckets.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Buckets</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {buckets.isPending ? "…" : rows.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ConnectionPicker />
          <FilterInput value={filter} onChange={setFilter} total={rows.length} />
        </div>
      </PanelHeader>

      {buckets.isPending ? (
        <LoadingRows />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.name}
          filter={filter}
          onOpen={(row) =>
            void navigate({ to: "/s3/buckets/$bucket", params: { bucket: row.name } })
          }
          emptyState={
            <EmptyState
              icon={Database}
              title="No buckets"
              hint="This account has no buckets, or the profile cannot list them."
            />
          }
        />
      )}
    </Panel>
  );
}
