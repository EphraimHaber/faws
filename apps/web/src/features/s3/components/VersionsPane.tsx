import type { S3VersionEntry } from "@faws/contracts";
import { byteSize, relativeTime } from "@faws/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { GitCompare, History, Trash } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { FilterInput } from "~/components/toolbar";
import { ObjectDiff, type DiffSide } from "~/features/s3/components/ObjectDiff";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useS3Scope } from "~/contexts/ScopeContext";
import { scopeKey } from "~/features/s3/scopeKey";
import { fullTimestamp } from "~/lib/format";
import { trpcClient } from "~/lib/trpc";
import { useFilterSearch } from "~/hooks/useSearchState";

/**
 * A row's identity: a key can appear many times, once per version.
 *
 * Defined once because the table hands these strings back as the selection,
 * and a second spelling of the same thing silently matches nothing.
 */
function versionKey(row: S3VersionEntry): string {
  return `${row.key}@${row.versionId}`;
}

/**
 * Every version under the prefix, including the markers left by deletes.
 *
 * A delete marker is why an object looks gone on a versioned bucket, so it is
 * a row here rather than something filtered out: the difference between "this
 * was deleted and can come back" and "this never existed" is the question the
 * pane exists to answer.
 */
export function VersionsPane({
  bucket,
  prefix,
  onOpenVersion,
}: {
  bucket: string;
  prefix: string;
  onOpenVersion: (key: string, versionId: string) => void;
}) {
  const scope = useS3Scope();
  const [filter, setFilter] = useFilterSearch();
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const [comparing, setComparing] = React.useState<{ left: DiffSide; right: DiffSide } | null>(
    null,
  );

  const listing = useInfiniteQuery({
    queryKey: ["s3:versions", ...scopeKey(scope), bucket, prefix],
    initialPageParam: { keyMarker: undefined, versionIdMarker: undefined } as {
      keyMarker: string | undefined;
      versionIdMarker: string | undefined;
    },
    queryFn: ({ pageParam }) => trpcClientVersions({ ...scope, bucket, prefix }, pageParam),
    // Two markers rather than one token, so the cursor is an object.
    getNextPageParam: (last) =>
      last.nextKeyMarker
        ? {
            keyMarker: last.nextKeyMarker,
            versionIdMarker: last.nextVersionIdMarker ?? undefined,
          }
        : undefined,
    staleTime: 60_000,
  });

  const rows = React.useMemo(
    () => (listing.data?.pages ?? []).flatMap((page) => page.versions),
    [listing.data],
  );

  const columns = React.useMemo<Column<S3VersionEntry>[]>(
    () => [
      {
        id: "key",
        header: "Key",
        value: (row) => row.key,
        cell: (row) => (
          <span className="flex items-center gap-2">
            {row.isDeleteMarker ? (
              <Trash className="size-3.5 shrink-0 text-danger" strokeWidth={1.7} />
            ) : (
              <History className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
            )}
            <span className="truncate">{row.key}</span>
          </span>
        ),
      },
      {
        id: "state",
        header: "State",
        width: "9rem",
        value: (row) => (row.isDeleteMarker ? "delete marker" : row.isLatest ? "latest" : ""),
        cell: (row) =>
          row.isDeleteMarker ? (
            <Badge tone="danger">delete marker</Badge>
          ) : row.isLatest ? (
            <Badge tone="success">latest</Badge>
          ) : null,
      },
      {
        id: "size",
        header: "Size",
        width: "8rem",
        align: "right",
        mono: true,
        value: (row) => row.size,
        cell: (row) => (row.isDeleteMarker ? "-" : byteSize(row.size)),
      },
      {
        id: "modified",
        header: "Modified",
        width: "12rem",
        value: (row) => row.lastModified ?? "",
        cell: (row) => (
          <span
            className="font-mono text-[11px] text-muted-foreground"
            title={fullTimestamp(row.lastModified)}
          >
            {relativeTime(row.lastModified)}
          </span>
        ),
      },
      {
        id: "version",
        header: "Version",
        width: "16rem",
        mono: true,
        value: (row) => row.versionId,
      },
    ],
    [],
  );

  /**
   * The two ticked versions, oldest first.
   *
   * A comparison reads in one direction, and the older side being the
   * left one is what makes the additions read as what arrived later.
   */
  const pair = rows
    .filter((row) => selected.has(versionKey(row)) && !row.isDeleteMarker)
    .toSorted((a, b) => (a.lastModified ?? "").localeCompare(b.lastModified ?? ""));

  if (listing.isError) {
    return <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />;
  }
  if (listing.isPending) return <LoadingRows />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{prefix || "/"}</span>
        <span className="ml-auto flex items-center gap-2">
          {pair.length === 2 ? (
            <Button
              size="sm"
              onClick={() =>
                setComparing({
                  left: {
                    key: pair[0]?.key ?? "",
                    versionId: pair[0]?.versionId ?? "",
                    label: relativeTime(pair[0]?.lastModified ?? null),
                  },
                  right: {
                    key: pair[1]?.key ?? "",
                    versionId: pair[1]?.versionId ?? "",
                    label: relativeTime(pair[1]?.lastModified ?? null),
                  },
                })
              }
            >
              <GitCompare className="size-3" /> Compare
            </Button>
          ) : selected.size > 0 ? (
            <span className="font-mono text-[10.5px] text-muted-foreground">
              tick two versions to compare
            </span>
          ) : null}
          <FilterInput value={filter} onChange={setFilter} total={rows.length} />
        </span>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={versionKey}
        filter={filter}
        selection={{ selected, onChange: setSelected }}
        // A marker has no bytes, so there is nothing to compare it against.
        selectable={(row) => !row.isDeleteMarker}
        onOpen={(row) => {
          // A marker has no bytes to open; the version under it does.
          if (!row.isDeleteMarker) onOpenVersion(row.key, row.versionId);
        }}
        onEndReached={() => {
          if (listing.hasNextPage && !listing.isFetchingNextPage) void listing.fetchNextPage();
        }}
        footer={
          <p className="flex items-center gap-2 border-t border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">
            {listing.isFetchingNextPage ? <Spinner className="size-3" /> : null}
            {rows.length} versions
            {listing.hasNextPage ? ", more below" : ""}
          </p>
        }
        emptyState={
          <EmptyState
            icon={History}
            title="No versions here"
            hint="Either nothing under this prefix, or the bucket does not keep versions."
          />
        }
      />

      {comparing ? (
        <ObjectDiff
          bucket={bucket}
          left={comparing.left}
          right={comparing.right}
          onClose={() => setComparing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The versions query, called directly rather than through the query helper.
 *
 * That helper threads one page param into a field named `cursor`, and this
 * listing resumes from two markers instead.
 */
function trpcClientVersions(
  input: { profile: string; region: string; bucket: string; prefix: string },
  cursor: { keyMarker: string | undefined; versionIdMarker: string | undefined },
) {
  return trpcClient.s3.versions.query({
    ...input,
    ...(cursor.keyMarker ? { keyMarker: cursor.keyMarker } : {}),
    ...(cursor.versionIdMarker ? { versionIdMarker: cursor.versionIdMarker } : {}),
  });
}
