/**
 * How each table is arranged: which columns it shows, and in what order.
 *
 * Kept in the settings file rather than in `localStorage` for the reason pins
 * are: an arrangement someone took the trouble to set up should follow them
 * from the browser to the desktop app. It is a map keyed by table, so it is
 * changed through its own op rather than through the patch schema, which
 * would have to replace the whole map to change one table.
 *
 * Column ids are the code's, not the person's, so a stored layout can name a
 * column that no longer exists or miss one added since; the table reconciles
 * that when it reads the layout, and nothing here has to.
 */
import { z } from "zod";

import { recordOfEach } from "./persisted.ts";

const columnIds = z.array(z.string().min(1).max(64)).max(64).catch([]);

export const tableLayoutSchema = z.object({
  /** Column ids in display order; ones missing from it keep their declared place. */
  order: columnIds,
  hidden: columnIds,
  /** Columns a table hides until asked, that someone asked for. */
  shown: columnIds,
});

export type TableLayout = z.infer<typeof tableLayoutSchema>;

export const tablesSettingsSchema = z.object({
  layouts: recordOfEach(tableLayoutSchema),
});

export type TablesSettings = z.infer<typeof tablesSettingsSchema>;

const tableId = z.string().min(1).max(64);

export const tableLayoutOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), table: tableId, layout: tableLayoutSchema }),
  z.object({ op: z.literal("reset"), table: tableId }),
]);

export type TableLayoutOp = z.infer<typeof tableLayoutOpSchema>;

/**
 * More than the app has tables; it exists so a client sending made-up table
 * ids cannot grow the file without bound.
 */
export const MAX_TABLE_LAYOUTS = 100;

export function applyTableLayoutOp(current: TablesSettings, op: TableLayoutOp): TablesSettings {
  switch (op.op) {
    case "set": {
      const known = op.table in current.layouts;
      if (!known && Object.keys(current.layouts).length >= MAX_TABLE_LAYOUTS) return current;
      return { layouts: { ...current.layouts, [op.table]: op.layout } };
    }
    case "reset": {
      const { [op.table]: _removed, ...layouts } = current.layouts;
      return { layouts };
    }
  }
}
