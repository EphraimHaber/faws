import type { TableLayout } from "@faws/contracts";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { ArrowDown, ArrowUp } from "lucide-react";
import * as React from "react";

import { describe } from "~/lib/hotkeys";
import { useOverlaysOpen } from "~/stores/overlays";

import { COLUMN_DRAG_TYPE, TableSettings } from "~/components/table-settings";
import { useListNavigation } from "~/hooks/useListNavigation";
import { parseText, useSearchState } from "~/hooks/useSearchState";
import {
  arrangeColumns,
  colsParam,
  EMPTY_LAYOUT,
  dropColumn,
  layoutFromCols,
  parseSort,
  sortParam,
  type SortState,
  toggleColumn,
} from "~/lib/table-layout";
import { cn } from "~/lib/utils";
import { pinnedFirst, type ResourceRef, usePinDrag, usePinnedRanks } from "~/stores/recents";
import { applyTableLayout, useSettings } from "~/stores/settings";

export interface Column<T> {
  readonly id: string;
  readonly header: string;
  /** Plain text used for filtering, sorting and the clipboard. */
  readonly value: (row: T) => string | number | null;
  /** Rich cell; falls back to `value` when omitted. */
  readonly cell?: (row: T) => React.ReactNode;
  readonly width?: string;
  readonly align?: "left" | "right";
  readonly mono?: boolean;
  /**
   * Kept in view at the right edge while the rest of the table scrolls
   * sideways. For a column of actions, which is useless scrolled off-screen.
   */
  readonly pin?: "end";
  /** Hidden until someone shows it from the table's gear, for detail most rows do not need. */
  readonly defaultHidden?: boolean;
  /**
   * What each row pins, for the column that pins it. A table with such a
   * column lists its pinned rows first, in the pinned order, and lets them be
   * dragged into a new one.
   */
  readonly pinTarget?: (row: T) => ResourceRef;
}

/**
 * A pinned cell sits over the cells scrolling beneath it, so it needs an opaque
 * background. The row's hover and active tints are translucent, so they are
 * painted over the card colour rather than in place of it - the same colour
 * the unpinned cells beside it show.
 */
const PINNED_BASE = "sticky right-0 z-[1] border-l border-border/45 bg-card";
const PINNED_HOVER =
  "group-hover:[background-image:linear-gradient(color-mix(in_oklab,var(--accent)_60%,transparent),color-mix(in_oklab,var(--accent)_60%,transparent))]";
const PINNED_ACTIVE = "[background-image:linear-gradient(var(--accent),var(--accent))]";

/**
 * Which rows are ticked, and how that changes.
 *
 * The set is held by the caller: the rows a table shows are a page of
 * something longer, and a selection that lived here would be forgotten every
 * time the list grew or refetched.
 */
export interface DataTableSelection {
  readonly selected: ReadonlySet<string>;
  onChange(next: Set<string>): void;
}

export interface DataTableProps<T> {
  /** Names the table in the settings file, where its column layout is kept. */
  readonly tableId: string;
  readonly rows: ReadonlyArray<T>;
  readonly columns: ReadonlyArray<Column<T>>;
  readonly rowKey: (row: T) => string;
  readonly onOpen?: (row: T) => void;
  /** Text from the toolbar: plain text, or `column:value`. */
  readonly filter?: string;
  /** Clears the page's filter, so the gear's reset can reach it. */
  readonly onClearFilter?: () => void;
  readonly emptyState?: React.ReactNode;
  /** Adds a leading tick column; absent means no selection at all. */
  readonly selection?: DataTableSelection;
  /** Rows the tick column skips, such as the folders in a file list. */
  readonly selectable?: (row: T) => boolean;
  /** Called as the last row comes into view, to load the page after it. */
  readonly onEndReached?: () => void;
  /** Sits under the last row: a count, a spinner, a load more button. */
  readonly footer?: React.ReactNode;
}

/** Pixel widths keyed by column id, tagged with the column set they were
 *  measured from; absent until the first drag freezes a layout. */
type SizedColumns = { signature: string; widths: Record<string, number> } | null;

/** A column can be dragged down to this and no further - narrower than a
 *  header's own text is a column you can no longer find. */
const MIN_COLUMN_WIDTH = 48;

/**
 * F1 opens help, so the first column sorts on F2. Listed explicitly because
 * the hotkey type only accepts literal function keys, not a computed string.
 */
const SORT_KEYS = ["F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"] as const;
const SORT_KEY_OFFSET = 2;

/**
 * The table the whole app is built on.
 *
 * It keeps the three things a TUI table gets right — everything visible at
 * once, `column:value` filtering, sort by column — and adds what a terminal
 * grid can't: real column widths, sticky headers, rich cells, and a row
 * cursor that works with both j/k and the mouse.
 */
export function DataTable<T>({
  tableId,
  rows,
  columns: declared,
  rowKey,
  onOpen,
  filter = "",
  onClearFilter,
  emptyState,
  selection,
  selectable,
  onEndReached,
  footer,
}: DataTableProps<T>) {
  const overlayOpen = useOverlaysOpen();
  // Sort and columns ride in the URL beside the filter, so a pasted link opens
  // on the same view. A `cols` link wins over the stored layout: it is the
  // sender's view, and the stored one is only the default for no link at all.
  const [sort, setSort] = useSearchState<SortState>({
    key: "sort",
    fallback: null,
    parse: parseSort,
    serialize: sortParam,
  });
  const [cols, setCols] = useSearchState<string>({ key: "cols", fallback: "", parse: parseText });
  const stored = useSettings((state) => state.settings.tables.layouts[tableId]);
  const linked = React.useMemo(() => layoutFromCols(cols || undefined, declared), [cols, declared]);
  const layout = linked ?? stored;
  const arranged = React.useMemo(() => arrangeColumns(declared, layout), [declared, layout]);
  const columns = arranged.visible;
  const { widths, headerRef, startResize, resetWidths } = useColumnWidths(columns);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);

  // Filtering reads every declared column, shown or not: `az:1a` should
  // still find rows while the zone column is hidden.
  const filtered = React.useMemo(
    () => applyFilter(rows, declared, filter),
    [rows, declared, filter],
  );
  const pinTarget = React.useMemo(() => declared.find((c) => c.pinTarget)?.pinTarget, [declared]);
  const pinRanks = usePinnedRanks();
  const pinDrag = usePinDrag();
  const sorted = React.useMemo(() => {
    const byColumn = applySort(filtered, declared, sort);
    return pinTarget ? pinnedFirst(byColumn, pinRanks, pinTarget) : byColumn;
  }, [filtered, declared, sort, pinTarget, pinRanks]);

  const setLayout = (next: TableLayout) => {
    applyTableLayout({ op: "set", table: tableId, layout: next });
    setCols(colsParam(arrangeColumns(declared, next).visible));
  };
  const currentOrder = () => arranged.all.map((entry) => entry.column.id);
  const drop = (id: string, targetId: string) =>
    setLayout({ ...EMPTY_LAYOUT, ...layout, order: dropColumn(currentOrder(), id, targetId) });

  const open = React.useCallback(
    (row: T) => {
      onOpen?.(row);
    },
    [onOpen],
  );
  const { activeIndex, setActiveIndex, rowRef } = useListNavigation(sorted, open, Boolean(onOpen));
  const { toggleRow, toggleAll, allTicked, someTicked, canTick } = useRowSelection(
    sorted,
    rowKey,
    selection,
    selectable,
  );

  const toggleSort = React.useCallback(
    (columnId: string) => {
      if (sort?.columnId !== columnId) setSort({ columnId, direction: "asc" });
      else if (sort.direction === "asc") setSort({ columnId, direction: "desc" });
      else setSort(null);
    },
    [sort, setSort],
  );

  // Function keys sort by column, as in e1s - offset by one because F1 is
  // reserved for the help overlay, so F2 sorts the first column.
  useHotkeys(
    columns.slice(0, SORT_KEYS.length).map((column, index) => ({
      hotkey: SORT_KEYS[index]!,
      callback: () => toggleSort(column.id),
      options: { meta: describe("Table", `Sort by ${column.header}`) },
    })),
    { preventDefault: true, enabled: !overlayOpen },
  );

  // `c` yields the selected row as JSON - the clipboard escape hatch for
  // anything the UI doesn't surface a field for.
  useHotkeys(
    [
      {
        hotkey: "C",
        callback: () => {
          const row = sorted[activeIndex];
          if (row) void navigator.clipboard?.writeText(JSON.stringify(row, null, 2));
        },
        options: { meta: describe("Table", "Copy selected row as JSON") },
      },
    ],
    { preventDefault: true, enabled: !overlayOpen },
  );

  useHotkeys(
    [
      {
        hotkey: "X",
        callback: () => {
          const row = sorted[activeIndex];
          if (row) toggleRow(row, activeIndex, false);
        },
        options: { meta: describe("Table", "Tick the row under the cursor") },
      },
    ],
    { preventDefault: true, enabled: !overlayOpen && Boolean(selection) },
  );

  if (sorted.length === 0) {
    return <div className="flex min-h-0 flex-1 flex-col">{emptyState}</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Once widths are measured the table lays out fixed at whatever the
          columns add up to: dragging one wider grows the table past the
          viewport and the container scrolls sideways, rather than stealing
          the space back off its neighbours. */}
      <table
        className={cn("border-collapse text-[12.5px]", widths ? "table-fixed" : "w-full")}
        style={
          widths
            ? {
                width: totalWidth(columns, widths) + (selection ? TICK_COLUMN_WIDTH : 0),
                minWidth: "100%",
              }
            : { minWidth: hintedWidth(columns, selection !== undefined) }
        }
      >
        {widths ? (
          <colgroup>
            {selection ? <col style={{ width: TICK_COLUMN_WIDTH }} /> : null}
            {columns.map((column) => (
              <col key={column.id} style={{ width: widths[column.id] }} />
            ))}
          </colgroup>
        ) : null}
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            {selection ? (
              <th
                style={{ width: TICK_COLUMN_WIDTH }}
                className="h-8 px-2 text-left font-normal"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  aria-label="Select every loaded row"
                  checked={allTicked}
                  ref={(node) => {
                    // The dash for a partial selection has no attribute; it
                    // only exists as a property on the element.
                    if (node) node.indeterminate = someTicked && !allTicked;
                  }}
                  onChange={() => toggleAll()}
                  className="size-3.5 cursor-pointer accent-primary"
                />
              </th>
            ) : null}
            {columns.map((column, index) => {
              const active = sort?.columnId === column.id;
              const last = index === columns.length - 1;
              const movable = column.pin !== "end";
              return (
                <th
                  key={column.id}
                  ref={headerRef(column.id)}
                  style={!widths && column.width ? { width: column.width } : undefined}
                  draggable={movable}
                  onDragStart={(event) => event.dataTransfer.setData(COLUMN_DRAG_TYPE, column.id)}
                  onDragOver={(event) => {
                    if (!movable || !event.dataTransfer.types.includes(COLUMN_DRAG_TYPE)) return;
                    event.preventDefault();
                    setDropTarget(column.id);
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDragEnd={() => setDropTarget(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDropTarget(null);
                    const id = event.dataTransfer.getData(COLUMN_DRAG_TYPE);
                    if (id && id !== column.id) drop(id, column.id);
                  }}
                  className={cn(
                    "relative h-8 cursor-pointer select-none px-3 font-mono text-[10px] font-normal tracking-[0.14em] whitespace-nowrap text-muted-foreground uppercase transition-colors hover:text-foreground",
                    column.align === "right" ? "text-right" : "text-left",
                    active && "text-foreground",
                    column.pin === "end" && PINNED_BASE,
                    // Room for the gear, which sits in the last header cell.
                    last && "pr-9",
                    dropTarget === column.id && "shadow-[inset_2px_0_0_var(--primary)]",
                  )}
                  onClick={() => toggleSort(column.id)}
                  title={`Sort by ${column.header} (F${index + SORT_KEY_OFFSET}); drag to reorder`}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 align-middle",
                      column.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {column.header}
                    {active ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="size-2.5 shrink-0" />
                      ) : (
                        <ArrowDown className="size-2.5 shrink-0" />
                      )
                    ) : null}
                  </span>
                  <ResizeHandle column={column} onStart={startResize} onReset={resetWidths} />
                  {last ? (
                    <TableSettings
                      columns={arranged.all.map(({ column: entry, hidden }) => ({
                        id: entry.id,
                        header: entry.header,
                        hidden,
                        pinned: entry.pin === "end",
                      }))}
                      onToggle={(id) =>
                        setLayout(toggleColumn(declared, layout ?? EMPTY_LAYOUT, id))
                      }
                      onMove={drop}
                      onResetColumns={() => {
                        applyTableLayout({ op: "reset", table: tableId });
                        setCols("");
                        resetWidths();
                      }}
                      onResetView={() => {
                        setSort(null);
                        resetWidths();
                        onClearFilter?.();
                      }}
                      viewChanged={sort !== null || widths !== null || filter.trim() !== ""}
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr
              key={rowKey(row)}
              ref={rowRef(index)}
              {...(pinTarget ? pinDrag(pinTarget(row)) : {})}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => open(row)}
              onDoubleClick={() => open(row)}
              className={cn(
                "group border-b border-border/45 transition-colors",
                onOpen && "cursor-pointer",
                // Drawn on the cells: a shadow on a collapsed-border row is not.
                "data-[pin-drop=before]:*:shadow-[inset_0_2px_0_var(--primary)] data-[pin-drop=after]:*:shadow-[inset_0_-2px_0_var(--primary)]",
                index === activeIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              {selection ? (
                <td
                  className="px-2"
                  onClick={(event) => {
                    // The tick is inside a row whose click opens it.
                    event.stopPropagation();
                  }}
                >
                  {canTick(row) ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${rowKey(row)}`}
                      checked={selection.selected.has(rowKey(row))}
                      // The click carries the shift key that a range needs;
                      // `onChange` exists only so the box is not read only.
                      onChange={() => undefined}
                      onClick={(event) => toggleRow(row, index, event.shiftKey)}
                      className="size-3.5 cursor-pointer accent-primary"
                    />
                  ) : null}
                </td>
              ) : null}
              {columns.map((column) => {
                // Cells wrap rather than ellipsize: a name or an ARN cut to
                // "cloudbay-collector-de…" is a name nobody can read or tell
                // from its neighbours. A long one makes its row taller.
                const text = String(column.value(row) ?? "");
                return (
                  <td
                    key={column.id}
                    className={cn(
                      "h-[34px] px-3 py-1.5 [overflow-wrap:anywhere]",
                      // Without measured widths the table is auto-laid out,
                      // where a zero max-width keeps a long value wrapping
                      // inside its column instead of stretching the column.
                      !widths && "max-w-0",
                      column.align === "right" && "text-right",
                      column.mono && "font-mono text-[11.5px] tabular",
                      column.pin === "end" &&
                        cn(PINNED_BASE, index === activeIndex ? PINNED_ACTIVE : PINNED_HOVER),
                    )}
                  >
                    {column.cell ? column.cell(row) : text || "-"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {onEndReached ? <EndSentinel onReach={onEndReached} /> : null}
      {footer}
    </div>
  );
}

/** Wide enough for a tick box and the gap either side of it. */
const TICK_COLUMN_WIDTH = 30;

/**
 * Calls back when it scrolls into view.
 *
 * The observer is rooted on the scroll container rather than the viewport,
 * because the table sits inside an element with its own overflow and would
 * otherwise never intersect anything. That root is read from the sentinel's
 * own parent: React attaches child refs before parent ones, so a ref held on
 * the container is still null at the moment this runs.
 */
function EndSentinel({ onReach }: { onReach: () => void }) {
  const latest = React.useRef(onReach);
  React.useEffect(() => {
    latest.current = onReach;
  });

  const ref = React.useCallback((node: HTMLDivElement | null) => {
    const root = node?.parentElement;
    if (!node || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      // A margin means the next page is already on its way by the time the
      // last row is read, rather than arriving after a visible stop.
      { root, rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className="h-px" aria-hidden />;
}

/**
 * Tick state for the rows on screen.
 *
 * Shift extends from the last row ticked, which is the gesture every file list
 * has. The anchor is remembered rather than derived, because which rows lie
 * between two keys depends on the order they are being shown in.
 */
function useRowSelection<T>(
  rows: ReadonlyArray<T>,
  rowKey: (row: T) => string,
  selection: DataTableSelection | undefined,
  selectable: ((row: T) => boolean) | undefined,
) {
  const anchorRef = React.useRef<number | null>(null);
  const canTick = React.useCallback((row: T) => selectable?.(row) ?? true, [selectable]);
  const tickable = React.useMemo(() => rows.filter(canTick), [rows, canTick]);
  const selected = selection?.selected;

  const allTicked = tickable.length > 0 && tickable.every((row) => selected?.has(rowKey(row)));
  const someTicked = tickable.some((row) => selected?.has(rowKey(row)));

  const toggleRow = React.useCallback(
    (row: T, index: number, extend: boolean) => {
      if (!selection || !canTick(row)) return;
      const next = new Set(selection.selected);
      const key = rowKey(row);
      const adding = !next.has(key);
      const anchor = anchorRef.current;

      if (extend && anchor !== null) {
        const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
        for (const candidate of rows.slice(from, to + 1)) {
          if (!canTick(candidate)) continue;
          const candidateKey = rowKey(candidate);
          if (adding) next.add(candidateKey);
          else next.delete(candidateKey);
        }
      } else if (adding) {
        next.add(key);
      } else {
        next.delete(key);
      }

      anchorRef.current = index;
      selection.onChange(next);
    },
    [selection, rows, rowKey, canTick],
  );

  const toggleAll = React.useCallback(() => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const row of tickable) {
      const key = rowKey(row);
      if (allTicked) next.delete(key);
      else next.add(key);
    }
    anchorRef.current = null;
    selection.onChange(next);
  }, [selection, tickable, rowKey, allTicked]);

  return { toggleRow, toggleAll, allTicked, someTicked, canTick };
}

/**
 * Drag-to-resize, on top of the browser's own column sizing.
 *
 * Nothing is measured until a drag starts: until then the browser lays the
 * table out from the `width` hints and the content, which is the layout that
 * looked right before this existed. The first pointer-down freezes that
 * layout into pixels - a fixed table is the only kind where one column can
 * grow without the others giving way - and every drag after it edits those
 * pixels. Widths are unbounded on purpose; the container scrolls sideways.
 */
function useColumnWidths<T>(columns: ReadonlyArray<Column<T>>) {
  const [sized, setSized] = React.useState<SizedColumns>(null);
  const headers = React.useRef(new Map<string, HTMLTableCellElement>());

  // A different set of columns is a different table, and its widths are not
  // this one's: a stale entry is ignored rather than cleared, so changing
  // tables costs no render of its own.
  const signature = columns.map((column) => column.id).join("\u0000");
  const widths = sized?.signature === signature ? sized.widths : null;

  const headerRef = React.useCallback(
    (columnId: string) => (node: HTMLTableCellElement | null) => {
      if (node) headers.current.set(columnId, node);
      else headers.current.delete(columnId);
    },
    [],
  );

  const startResize = React.useCallback(
    (columnId: string, event: React.PointerEvent<HTMLElement>) => {
      const base: Record<string, number> = {};
      for (const [id, node] of headers.current) {
        base[id] = Math.round(node.getBoundingClientRect().width);
      }

      const start = event.clientX;
      const from = base[columnId] ?? MIN_COLUMN_WIDTH;
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const resize = (clientX: number) => {
        const next = Math.max(MIN_COLUMN_WIDTH, Math.round(from + (clientX - start)));
        setSized({ signature, widths: { ...base, [columnId]: next } });
      };
      // Freeze the measured layout immediately, so the first pixel of drag
      // moves a column rather than re-flowing the whole table.
      resize(start);

      const move = (moveEvent: PointerEvent) => resize(moveEvent.clientX);
      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    },
    [signature],
  );

  // Double-click hands the table back to the browser: with no pixel widths it
  // lays itself out from the content again.
  const resetWidths = React.useCallback(() => {
    setSized(null);
  }, []);

  return { widths, headerRef, startResize, resetWidths };
}

/** The narrowest a column without a width hint is allowed to get. */
const FLEXIBLE_FLOOR = "10rem";

/**
 * What the width hints add up to, as the table's floor before any drag.
 *
 * Without it, an auto-laid-out table in a narrow window shrinks every column
 * below its hint - `max-w-0` on the cells lets it - and a column of buttons is
 * clipped rather than scrolled to. With it, the hints hold and the container
 * scrolls sideways, as it does once a column has been dragged wider.
 */
function hintedWidth<T>(columns: ReadonlyArray<Column<T>>, selection: boolean): string {
  const parts = columns.map((column) => column.width ?? FLEXIBLE_FLOOR);
  if (selection) parts.push(`${TICK_COLUMN_WIDTH}px`);
  return `calc(${parts.join(" + ")})`;
}

function totalWidth<T>(columns: ReadonlyArray<Column<T>>, widths: Record<string, number>): number {
  return columns.reduce((sum, column) => sum + (widths[column.id] ?? 0), 0);
}

/** The grab strip on a header's trailing edge. */
function ResizeHandle<T>({
  column,
  onStart,
  onReset,
}: {
  column: Column<T>;
  onStart: (columnId: string, event: React.PointerEvent<HTMLElement>) => void;
  onReset: () => void;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${column.header}`}
      // The header itself sorts on click, so every pointer event that belongs
      // to the drag stops here.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onReset();
      }}
      // The header is draggable to reorder; a resize must not start a move.
      draggable={false}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onStart(column.id, event);
      }}
      className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:top-1.5 after:bottom-1.5 after:left-[3px] after:w-px after:bg-transparent after:transition-colors hover:after:bg-primary/60"
    />
  );
}

/**
 * `service:api` restricts to one column; bare text matches any column. Same
 * grammar as e1s's `/` filter, so muscle memory carries over.
 */
function applyFilter<T>(
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<Column<T>>,
  filter: string,
): T[] {
  const query = filter.trim().toLowerCase();
  if (query.length === 0) return [...rows];

  const colon = query.indexOf(":");
  if (colon > 0) {
    const columnId = query.slice(0, colon);
    const needle = query.slice(colon + 1);
    const column = columns.find(
      (c) => c.id.toLowerCase() === columnId || c.header.toLowerCase() === columnId,
    );
    if (column) {
      return rows.filter((row) =>
        String(column.value(row) ?? "")
          .toLowerCase()
          .includes(needle),
      );
    }
  }

  return rows.filter((row) =>
    columns.some((column) =>
      String(column.value(row) ?? "")
        .toLowerCase()
        .includes(query),
    ),
  );
}

function applySort<T>(
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<Column<T>>,
  sort: SortState,
): T[] {
  if (!sort) return [...rows];
  const column = columns.find((c) => c.id === sort.columnId);
  if (!column) return [...rows];
  const direction = sort.direction === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left ?? "").localeCompare(String(right ?? "")) * direction;
  });
}
