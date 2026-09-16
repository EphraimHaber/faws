import { useHotkeys } from "@tanstack/react-hotkeys";
import { ArrowDown, ArrowUp } from "lucide-react";
import * as React from "react";

import { describe } from "~/lib/hotkeys";
import { useOverlaysOpen } from "~/stores/overlays";

import { useListNavigation } from "~/hooks/useListNavigation";
import { cn } from "~/lib/utils";

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
}

export interface DataTableProps<T> {
  readonly rows: ReadonlyArray<T>;
  readonly columns: ReadonlyArray<Column<T>>;
  readonly rowKey: (row: T) => string;
  readonly onOpen?: (row: T) => void;
  /** Text from the toolbar: plain text, or `column:value`. */
  readonly filter?: string;
  readonly emptyState?: React.ReactNode;
}

type SortState = { columnId: string; direction: "asc" | "desc" } | null;

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
  rows,
  columns,
  rowKey,
  onOpen,
  filter = "",
  emptyState,
}: DataTableProps<T>) {
  const overlayOpen = useOverlaysOpen();
  const [sort, setSort] = React.useState<SortState>(null);

  const filtered = React.useMemo(() => applyFilter(rows, columns, filter), [rows, columns, filter]);
  const sorted = React.useMemo(() => applySort(filtered, columns, sort), [filtered, columns, sort]);

  const open = React.useCallback(
    (row: T) => {
      onOpen?.(row);
    },
    [onOpen],
  );
  const { activeIndex, setActiveIndex, rowRef } = useListNavigation(sorted, open, Boolean(onOpen));

  const toggleSort = React.useCallback((columnId: string) => {
    setSort((prev) => {
      if (prev?.columnId !== columnId) return { columnId, direction: "asc" };
      if (prev.direction === "asc") return { columnId, direction: "desc" };
      return null;
    });
  }, []);

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

  if (sorted.length === 0) {
    return <div className="flex min-h-0 flex-1 flex-col">{emptyState}</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            {columns.map((column, index) => {
              const active = sort?.columnId === column.id;
              return (
                <th
                  key={column.id}
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    "h-8 cursor-pointer select-none px-3 font-mono text-[10px] font-normal tracking-[0.14em] whitespace-nowrap text-muted-foreground uppercase transition-colors hover:text-foreground",
                    column.align === "right" ? "text-right" : "text-left",
                    active && "text-foreground",
                  )}
                  onClick={() => toggleSort(column.id)}
                  title={`Sort by ${column.header} (F${index + SORT_KEY_OFFSET})`}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      column.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {column.header}
                    {active ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="size-2.5" />
                      ) : (
                        <ArrowDown className="size-2.5" />
                      )
                    ) : null}
                  </span>
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
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => open(row)}
              onDoubleClick={() => open(row)}
              className={cn(
                "border-b border-border/45 transition-colors",
                onOpen && "cursor-pointer",
                index === activeIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              {columns.map((column) => {
                // Cells ellipsize to keep columns aligned, so the full text
                // goes in `title` - a truncated ARN or image digest is still
                // readable on hover, and `c` copies the whole row as JSON.
                const text = String(column.value(row) ?? "");
                return (
                  <td
                    key={column.id}
                    title={text}
                    className={cn(
                      "h-[34px] max-w-0 truncate px-3",
                      column.align === "right" && "text-right",
                      column.mono && "font-mono text-[11.5px] tabular",
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
    </div>
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
