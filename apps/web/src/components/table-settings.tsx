import { useHotkeys } from "@tanstack/react-hotkeys";
import { GripVertical, Settings2 } from "lucide-react";
import * as React from "react";

import { TextAction } from "~/components/ui/text-action";
import { cn } from "~/lib/utils";
import { useOverlay } from "~/stores/overlays";

/** The drag payload type for a column, so a stray text drag is not a move. */
export const COLUMN_DRAG_TYPE = "application/x-faws-column";

export interface ColumnEntry {
  readonly id: string;
  readonly header: string;
  readonly hidden: boolean;
  /** A pinned column stays last and is not dragged. */
  readonly pinned: boolean;
}

/**
 * The gear at the end of a table's header row: which columns show, in what
 * order, and a way back to how the table started.
 *
 * On the table rather than in Settings, because it answers a question about
 * this table while looking at it. Positioned fixed from the button, because
 * the table scrolls inside a box that would clip anything hanging below it.
 */
export function TableSettings({
  columns,
  onToggle,
  onMove,
  onResetColumns,
  onResetView,
  viewChanged,
}: {
  columns: ReadonlyArray<ColumnEntry>;
  onToggle: (id: string) => void;
  /** Moves `id` into the place of the column it was dropped on. */
  onMove: (id: string, targetId: string) => void;
  onResetColumns: () => void;
  onResetView: () => void;
  /** Whether a filter, a sort or a dragged width is in effect. */
  viewChanged: boolean;
}) {
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null);
  const open = anchor !== null;
  const { isTop } = useOverlay("table-settings", open);
  const [over, setOver] = React.useState<string | null>(null);

  useHotkeys(
    [{ hotkey: "Escape", callback: () => setAnchor(null), options: { ignoreInputs: false } }],
    { enabled: open && isTop },
  );

  const showing = columns.filter((column) => !column.hidden).length;

  return (
    <>
      <button
        type="button"
        aria-label="Table settings"
        title="Columns, order, and resetting the view"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(open ? null : event.currentTarget.getBoundingClientRect());
        }}
        className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Settings2 className="size-3.5" strokeWidth={1.8} />
      </button>

      {anchor ? (
        <>
          <button
            type="button"
            aria-label="Close table settings"
            className="fixed inset-0 z-40 cursor-default"
            onClick={(event) => {
              event.stopPropagation();
              setAnchor(null);
            }}
          />
          <div
            role="dialog"
            aria-label="Table settings"
            onClick={(event) => event.stopPropagation()}
            style={{ top: anchor.bottom + 6, right: window.innerWidth - anchor.right }}
            className="fixed z-50 flex max-h-[70vh] w-64 flex-col rounded-lg border border-border bg-popover text-left font-sans text-[12.5px] tracking-normal normal-case shadow-xl"
          >
            <p className="px-3 pt-2.5 pb-1 font-mono text-[9.5px] tracking-[0.2em] text-muted-foreground uppercase">
              Columns
            </p>
            <ul className="min-h-0 overflow-auto px-1.5 pb-1.5">
              {columns.map((column) => (
                <li
                  key={column.id}
                  draggable={!column.pinned}
                  onDragStart={(event) => event.dataTransfer.setData(COLUMN_DRAG_TYPE, column.id)}
                  onDragOver={(event) => {
                    if (column.pinned || !event.dataTransfer.types.includes(COLUMN_DRAG_TYPE))
                      return;
                    event.preventDefault();
                    setOver(column.id);
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setOver(null);
                    const id = event.dataTransfer.getData(COLUMN_DRAG_TYPE);
                    if (id && id !== column.id) onMove(id, column.id);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-1.5 py-1",
                    over === column.id && "shadow-[inset_0_2px_0_var(--primary)]",
                  )}
                >
                  <GripVertical
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0",
                      column.pinned ? "opacity-0" : "cursor-grab text-muted-foreground/60",
                    )}
                  />
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!column.hidden}
                      // The last column showing cannot be hidden: a table
                      // with nothing in it has nowhere to show it back from.
                      disabled={!column.hidden && showing <= 1}
                      onChange={() => onToggle(column.id)}
                      className="size-3.5 cursor-pointer accent-primary"
                    />
                    <span className="min-w-0 flex-1">{column.header}</span>
                  </label>
                  {column.pinned ? (
                    <span className="font-mono text-[9.5px] text-muted-foreground/70">pinned</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
              <TextAction onClick={onResetView} disabled={!viewChanged}>
                reset filter and sort
              </TextAction>
              <TextAction onClick={onResetColumns}>reset columns</TextAction>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
