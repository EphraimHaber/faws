import type { S3CommonPrefix, S3ObjectSummary } from "@faws/contracts";
import { byteSize, parentPrefix, relativeTime } from "@faws/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useHotkeys } from "@tanstack/react-hotkeys";
import {
  ArrowLeft,
  CornerLeftUp,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { FilterInput } from "~/components/toolbar";
import { DisabledHint, useDisabledReason } from "~/components/WriteGuard";
import { CreatePrefixDialog } from "~/features/s3/components/CreatePrefixDialog";
import { DeleteDialog, type DeleteTarget } from "~/features/s3/components/DeleteDialog";
import { IDLE_SCAN, ObjectSearch, type ScanState } from "~/features/s3/components/ObjectSearch";
import { UploadButton, UploadDropzone } from "~/features/s3/components/UploadDropzone";
import { PrefixTrail } from "~/features/s3/components/PrefixTrail";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useS3Scope } from "~/contexts/ScopeContext";
import { describe } from "~/lib/hotkeys";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { useOverlaysOpen } from "~/stores/overlays";
import { useFilterSearch } from "~/hooks/useSearchState";

/** Keys per request. Smaller than the API's 1000 cap: a shorter first page is
 *  a faster first row, and the rest arrives as you scroll. */
const PAGE_SIZE = 200;

/** Shared empty set, so a listing with nothing ticked keeps one identity. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/**
 * A row is either a folder or an object; S3 returns them as two separate
 * lists, and the table shows them as one with the folders on top.
 */
type Row =
  | { kind: "prefix"; id: string; entry: S3CommonPrefix }
  | { kind: "object"; id: string; entry: S3ObjectSummary };

export function ObjectBrowser({
  bucket,
  prefix,
  onNavigate,
  onOpenObject,
  versioned = null,
}: {
  bucket: string;
  prefix: string;
  onNavigate: (prefix: string) => void;
  onOpenObject: (key: string) => void;
  /** Whether a delete here is recoverable; null while it is still unknown. */
  versioned?: boolean | null;
}) {
  const scope = useS3Scope();
  const overlayOpen = useOverlaysOpen();
  const [filter, setFilter] = useFilterSearch();
  // A selection belongs to the listing it was made in. Walking into another
  // prefix shows different rows, so the ticks are dropped on read rather than
  // corrected afterwards by an effect.
  const listingId = `${bucket}\u0000${prefix}`;
  const [ticked, setTicked] = React.useState<{ at: string; keys: ReadonlySet<string> }>(() => ({
    at: listingId,
    keys: new Set(),
  }));
  const selected = ticked.at === listingId ? ticked.keys : EMPTY_SELECTION;
  const setSelected = React.useCallback(
    (keys: ReadonlySet<string>) => setTicked({ at: listingId, keys }),
    [listingId],
  );

  // Results belong to the prefix they were found under, so they are dropped on
  // read when the listing changes rather than cleared afterwards.
  const [scanned, setScanned] = React.useState<{ at: string; state: ScanState }>(() => ({
    at: listingId,
    state: IDLE_SCAN,
  }));
  const scan = scanned.at === listingId ? scanned.state : IDLE_SCAN;
  const setScan = React.useCallback(
    (state: ScanState) => setScanned({ at: listingId, state }),
    [listingId],
  );

  // Refusals are rendered, not hidden. A delete button that is absent and a
  // delete button this build does not have look the same, so hiding them made
  // read-only mode invisible at exactly the moment it mattered.
  const writeReason = useDisabledReason("write");
  const destroyReason = useDisabledReason("destructive");
  const [dialog, setDialog] = React.useState<
    { kind: "delete"; targets: ReadonlyArray<DeleteTarget> } | { kind: "prefix" } | null
  >(null);

  const listing = useInfiniteQuery({
    ...trpc.s3.list.infiniteQueryOptions(
      { ...scope, bucket, prefix, delimiter: "/", maxKeys: PAGE_SIZE },
      { getNextPageParam: (last) => last.nextToken },
    ),
    // A long listing is many pages, and the app wide refresh would refetch
    // every one of them; S3 list calls are billed per request.
    staleTime: 60_000,
  });

  const searching = scan.running || scan.hits.length > 0 || scan.progress !== null;

  const rows = React.useMemo<Row[]>(() => {
    // A search answers with keys from anywhere below, so its hits replace the
    // folder listing rather than filtering it.
    if (searching) {
      return scan.hits.map((entry): Row => ({ kind: "object", id: entry.key, entry }));
    }
    const pages = listing.data?.pages ?? [];
    return [
      ...pages.flatMap((page) =>
        page.prefixes.map((entry): Row => ({ kind: "prefix", id: entry.prefix, entry })),
      ),
      ...pages.flatMap((page) =>
        page.objects.map((entry): Row => ({ kind: "object", id: entry.key, entry })),
      ),
    ];
  }, [listing.data, searching, scan.hits]);

  const open = React.useCallback(
    (row: Row) => {
      if (row.kind === "prefix") onNavigate(row.entry.prefix);
      else onOpenObject(row.entry.key);
    },
    [onNavigate, onOpenObject],
  );

  const goUp = React.useCallback(() => {
    if (prefix.length > 0) onNavigate(parentPrefix(prefix));
  }, [prefix, onNavigate]);

  useHotkeys(
    [
      {
        hotkey: "U",
        callback: goUp,
        options: {
          enabled: !overlayOpen && prefix.length > 0,
          meta: describe("Navigation", "Up one prefix"),
        },
      },
    ],
    { preventDefault: true },
  );

  const columns = React.useMemo<Column<Row>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        value: (row) => (row.kind === "prefix" ? row.entry.name : row.entry.name),
        cell: (row) =>
          row.kind === "prefix" ? (
            <span className="flex items-center gap-2">
              <Folder className="size-3.5 shrink-0 text-info" strokeWidth={1.7} />
              <span className="font-medium">{row.entry.name}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
              <span className="">{row.entry.name}</span>
            </span>
          ),
      },
      {
        id: "size",
        header: "Size",
        width: "8rem",
        align: "right",
        mono: true,
        // Folders have no size of their own; S3 never reports one.
        value: (row) => (row.kind === "object" ? row.entry.size : -1),
        cell: (row) =>
          row.kind === "object" ? (
            byteSize(row.entry.size)
          ) : (
            <span className="text-muted-foreground/50">-</span>
          ),
      },
      {
        id: "modified",
        header: "Modified",
        width: "13rem",
        value: (row) => (row.kind === "object" ? (row.entry.lastModified ?? "") : ""),
        cell: (row) =>
          row.kind === "object" ? (
            <span
              className="font-mono text-[11px] text-muted-foreground"
              title={fullTimestamp(row.entry.lastModified)}
            >
              {relativeTime(row.entry.lastModified)}
            </span>
          ) : (
            <span className="text-muted-foreground/50">-</span>
          ),
      },
      {
        id: "storage",
        header: "Class",
        width: "9rem",
        value: (row) => (row.kind === "object" ? row.entry.storageClass : ""),
        cell: (row) =>
          row.kind === "object" && row.entry.storageClass !== "STANDARD" ? (
            <Badge tone="info">{row.entry.storageClass}</Badge>
          ) : null,
      },
    ],
    [],
  );

  if (listing.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />
      </Panel>
    );
  }

  const loaded = rows.length;
  const selectedKeys = [...selected];
  const selectedTargets: DeleteTarget[] = rows
    .filter((row): row is Extract<Row, { kind: "object" }> => row.kind === "object")
    .filter((row) => selected.has(row.id))
    .map((row) => ({ key: row.entry.key, size: row.entry.size }));

  return (
    <Panel className="flex-1">
      <PanelHeader className="gap-2">
        <PanelTitle className="shrink-0">Objects</PanelTitle>
        <PrefixTrail bucket={bucket} prefix={prefix} onNavigate={onNavigate} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {selectedKeys.length > 0 ? (
            <>
              <span className="font-mono text-[11px] text-primary tabular">
                {selectedKeys.length} selected
              </span>
              <CopyButton size="sm" label="Copy keys" value={() => selectedKeys.join("\n")} />
              <DisabledHint reason={destroyReason}>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={destroyReason !== null}
                  onClick={() => setDialog({ kind: "delete", targets: selectedTargets })}
                >
                  <Trash2 className="size-3" /> Delete
                </Button>
              </DisabledHint>
            </>
          ) : null}
          {searching ? (
            <>
              {/* The listing does not come back on its own: a scan answers with
                  keys from anywhere below, so its hits replace the folder view
                  entirely. Until this button existed the only way back was to
                  empty the box, which is not a thing anyone guesses. */}
              <Badge tone="info">scan results - {scan.hits.length} keys</Badge>
              <Button size="sm" variant="outline" onClick={() => setScan(IDLE_SCAN)}>
                <ArrowLeft className="size-3" /> Back to listing
              </Button>
            </>
          ) : null}
          <FilterInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter loaded rows… (try name:log)"
            total={loaded}
          />
        </div>
      </PanelHeader>

      <ObjectSearch bucket={bucket} prefix={prefix} state={scan} onState={setScan} />

      <UploadDropzone bucket={bucket} prefix={prefix}>
        {({ pickFiles, transport }) => (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
              {prefix.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={goUp}>
                  <CornerLeftUp className="size-3" /> Up
                </Button>
              ) : null}
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {prefix || "/"}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {transport}
                <DisabledHint reason={writeReason}>
                  <Button
                    size="sm"
                    disabled={writeReason !== null}
                    onClick={() => setDialog({ kind: "prefix" })}
                  >
                    <FolderPlus className="size-3" /> New folder
                  </Button>
                </DisabledHint>
                <DisabledHint reason={writeReason}>
                  <UploadButton onPick={pickFiles} disabled={writeReason !== null} />
                </DisabledHint>
              </span>
            </div>

            {listing.isPending ? (
              <LoadingRows />
            ) : (
              <DataTable
                tableId="s3-objects"
                rows={rows}
                columns={columns}
                rowKey={(row) => row.id}
                filter={filter}
                onClearFilter={() => setFilter("")}
                onOpen={open}
                selection={{ selected, onChange: setSelected }}
                selectable={(row) => row.kind === "object"}
                onEndReached={() => {
                  // A search has no pages of its own; it streams until it is done.
                  if (!searching && listing.hasNextPage && !listing.isFetchingNextPage) {
                    void listing.fetchNextPage();
                  }
                }}
                footer={
                  <p className="flex items-center gap-2 border-t border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">
                    {listing.isFetchingNextPage ? <Spinner className="size-3" /> : null}
                    {searching ? `${loaded} matched` : `${loaded} loaded`}
                    {!searching && listing.hasNextPage ? ", more below" : ""}
                  </p>
                }
                emptyState={
                  <EmptyState
                    icon={FolderOpen}
                    title={
                      searching
                        ? "Nothing matched"
                        : prefix.length > 0
                          ? "Nothing under this prefix"
                          : "This bucket is empty"
                    }
                    {...(searching
                      ? { hint: "* stops at a slash; ** crosses one." }
                      : prefix.length > 0
                        ? { hint: "Press u to go up one level." }
                        : {})}
                  />
                }
              />
            )}
          </>
        )}
      </UploadDropzone>

      {dialog?.kind === "delete" ? (
        <DeleteDialog
          bucket={bucket}
          versioned={versioned}
          targets={dialog.targets}
          onClose={() => {
            setDialog(null);
            setSelected(new Set());
          }}
        />
      ) : null}

      {dialog?.kind === "prefix" ? (
        <CreatePrefixDialog bucket={bucket} parentPrefix={prefix} onClose={() => setDialog(null)} />
      ) : null}
    </Panel>
  );
}
