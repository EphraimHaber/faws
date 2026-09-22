/**
 * A table's columns as someone arranged them, reconciled with the columns the
 * code declares today.
 *
 * The stored layout names column ids, and code moves on: a column can be
 * added after a layout was saved, or removed. So a stored order is a
 * preference applied over the declared order rather than a replacement for it
 * - a column the layout has never heard of keeps its declared place, and an
 * id the code no longer has is ignored. A pinned column is the way into a row
 * and stays last whatever was stored.
 */
import type { TableLayout } from "@faws/contracts";

interface LayoutColumn {
  readonly id: string;
  readonly pin?: "end";
  /** Starts hidden; for detail most people do not need on every row. */
  readonly defaultHidden?: boolean;
}

export const EMPTY_LAYOUT: TableLayout = { order: [], hidden: [], shown: [] };

function isHidden(column: LayoutColumn, layout: Partial<TableLayout>): boolean {
  if (layout.hidden?.includes(column.id)) return true;
  return column.defaultHidden === true && !layout.shown?.includes(column.id);
}

function ordered<C extends LayoutColumn>(columns: ReadonlyArray<C>, order: readonly string[]): C[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const known = order.filter((id) => byId.has(id));
  const result = known.map((id) => byId.get(id)!);
  // Columns the stored order does not mention go back to their declared index.
  columns.forEach((column, index) => {
    if (!known.includes(column.id)) result.splice(Math.min(index, result.length), 0, column);
  });
  return [
    ...result.filter((column) => column.pin !== "end"),
    ...result.filter((c) => c.pin === "end"),
  ];
}

export function arrangeColumns<C extends LayoutColumn>(
  columns: ReadonlyArray<C>,
  layout: Partial<TableLayout> | undefined,
): { visible: C[]; all: Array<{ column: C; hidden: boolean }> } {
  const stored = layout ?? EMPTY_LAYOUT;
  const all = ordered(columns, stored.order ?? []).map((column) => ({
    column,
    hidden: isHidden(column, stored),
  }));
  const visible = all.filter((entry) => !entry.hidden).map((entry) => entry.column);
  // A table with every column hidden is a table nobody can use or fix.
  return { visible: visible.length > 0 ? visible : all.slice(0, 1).map((e) => e.column), all };
}

/** `id` moved to just before `beforeId`, or to the end when that is null. */
export function moveColumn(
  order: readonly string[],
  id: string,
  beforeId: string | null,
): string[] {
  const without = order.filter((entry) => entry !== id);
  const at = beforeId === null ? without.length : without.indexOf(beforeId);
  return [
    ...without.slice(0, at < 0 ? without.length : at),
    id,
    ...without.slice(at < 0 ? without.length : at),
  ];
}

/**
 * `id` dropped onto `targetId`, taking its place.
 *
 * Which side it lands on depends on the direction it came from: dragged right
 * it goes after the target, dragged left it goes before. Always inserting
 * before would make dropping onto the next column to the right a no-op, since
 * "before the column after me" is where it already was.
 */
export function dropColumn(order: readonly string[], id: string, targetId: string): string[] {
  const from = order.indexOf(id);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...order];
  if (from > to) return moveColumn(order, id, targetId);
  return moveColumn(order, id, order[to + 1] ?? null);
}

/** Shows a hidden column or hides a shown one, never hiding the last one showing. */
export function toggleColumn(
  columns: ReadonlyArray<LayoutColumn>,
  layout: Partial<TableLayout>,
  id: string,
): TableLayout {
  const current = { ...EMPTY_LAYOUT, ...layout };
  const column = columns.find((entry) => entry.id === id);
  if (!column) return current;
  if (isHidden(column, current)) {
    return {
      ...current,
      hidden: current.hidden.filter((entry) => entry !== id),
      shown: column.defaultHidden ? [...current.shown.filter((e) => e !== id), id] : current.shown,
    };
  }
  const showing = columns.filter((entry) => !isHidden(entry, current));
  if (showing.length <= 1) return current;
  return {
    ...current,
    hidden: [...current.hidden, id],
    shown: current.shown.filter((entry) => entry !== id),
  };
}

/** Which column a table is sorted by, and which way. */
export type SortState = { columnId: string; direction: "asc" | "desc" } | null;

/**
 * `sort=type` sorts ascending and `sort=-type` descending: one param, and the
 * dash reads the way it does in most APIs that take a sort key.
 */
export function parseSort(raw: unknown): SortState {
  if (typeof raw !== "string") return null;
  const desc = raw.startsWith("-");
  const columnId = desc ? raw.slice(1) : raw;
  return columnId ? { columnId, direction: desc ? "desc" : "asc" } : null;
}

export function sortParam(sort: SortState): string | undefined {
  if (!sort) return undefined;
  return sort.direction === "desc" ? `-${sort.columnId}` : sort.columnId;
}

/**
 * The layout a `cols=` link describes: exactly these columns, in this order.
 *
 * It overrides the stored layout rather than merging with it, because a link
 * is somebody else's view and should arrive as they saw it. The pinned column
 * is not listed and always comes along.
 */
export function layoutFromCols(
  raw: unknown,
  columns: ReadonlyArray<LayoutColumn>,
): TableLayout | undefined {
  if (typeof raw !== "string") return undefined;
  const known = new Set(columns.map((column) => column.id));
  const listed = raw.split(",").filter((id) => known.has(id));
  if (listed.length === 0) return undefined;
  return {
    order: listed,
    hidden: columns
      .filter((column) => column.pin !== "end" && !listed.includes(column.id))
      .map((column) => column.id),
    shown: listed,
  };
}

/** The `cols=` value for these visible columns. */
export function colsParam(visible: ReadonlyArray<LayoutColumn>): string {
  return visible
    .filter((column) => column.pin !== "end")
    .map((column) => column.id)
    .join(",");
}
