import { describe, expect, it } from "vitest";

import {
  arrangeColumns,
  colsParam,
  layoutFromCols,
  moveColumn,
  parseSort,
  sortParam,
  toggleColumn,
} from "./table-layout.ts";

const columns = [
  { id: "name" },
  { id: "address" },
  { id: "type" },
  { id: "state" },
  { id: "shell", pin: "end" as const },
];
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((column) => column.id);

describe("arrangeColumns", () => {
  it("shows the declared order when nothing is stored", () => {
    expect(ids(arrangeColumns(columns, undefined).visible)).toEqual(ids(columns));
  });

  it("follows a stored order, and drops ids that no longer exist", () => {
    const layout = { order: ["state", "gone", "name", "address", "type"], hidden: [] };
    expect(ids(arrangeColumns(columns, layout).visible)).toEqual([
      "state",
      "name",
      "address",
      "type",
      "shell",
    ]);
  });

  it("puts a column added since the layout was saved where it was declared", () => {
    const layout = { order: ["state", "name", "type"], hidden: [] };
    // `address` is declared second, so it goes second.
    expect(ids(arrangeColumns(columns, layout).visible)).toEqual([
      "state",
      "address",
      "name",
      "type",
      "shell",
    ]);
  });

  it("keeps a pinned column last whatever order was stored", () => {
    const layout = { order: ["shell", "name", "address", "type", "state"], hidden: [] };
    expect(ids(arrangeColumns(columns, layout).visible).at(-1)).toBe("shell");
  });

  it("leaves hidden columns out of what is shown, but lists every column for the menu", () => {
    const arranged = arrangeColumns(columns, { order: [], hidden: ["type", "address"] });
    expect(ids(arranged.visible)).toEqual(["name", "state", "shell"]);
    expect(arranged.all.map((entry) => [entry.column.id, entry.hidden])).toEqual([
      ["name", false],
      ["address", true],
      ["type", true],
      ["state", false],
      ["shell", false],
    ]);
  });

  it("hides columns the table declares as hidden until someone shows them", () => {
    const withExtra = [...columns, { id: "ipv6", defaultHidden: true }];
    expect(ids(arrangeColumns(withExtra, undefined).visible)).not.toContain("ipv6");
    const shown = arrangeColumns(withExtra, { order: [], hidden: [], shown: ["ipv6"] });
    expect(ids(shown.visible)).toContain("ipv6");
  });
});

describe("moveColumn", () => {
  it("moves a column to just before another", () => {
    expect(moveColumn(ids(columns), "state", "name")).toEqual([
      "state",
      "name",
      "address",
      "type",
      "shell",
    ]);
  });

  it("moves a column to the end when dropped past the last one", () => {
    expect(moveColumn(ids(columns), "name", null)).toEqual([
      "address",
      "type",
      "state",
      "shell",
      "name",
    ]);
  });
});

describe("toggleColumn", () => {
  it("hides a shown column and shows a hidden one", () => {
    const hidden = toggleColumn(columns, { order: [], hidden: [] }, "type");
    expect(hidden.hidden).toEqual(["type"]);
    expect(toggleColumn(columns, hidden, "type").hidden).toEqual([]);
  });

  it("will not hide the last column still showing", () => {
    const one = { order: [], hidden: ["name", "address", "type", "state"] };
    expect(toggleColumn(columns, one, "shell").hidden).toEqual(one.hidden);
  });

  it("records showing a column that starts hidden, so it stays shown", () => {
    const withExtra = [...columns, { id: "ipv6", defaultHidden: true }];
    expect(toggleColumn(withExtra, { order: [], hidden: [] }, "ipv6").shown).toEqual(["ipv6"]);
  });
});

describe("sort in the URL", () => {
  it("reads a column id as ascending and a leading dash as descending", () => {
    expect(parseSort("type")).toEqual({ columnId: "type", direction: "asc" });
    expect(parseSort("-type")).toEqual({ columnId: "type", direction: "desc" });
  });

  it("reads anything else as no sort", () => {
    expect(parseSort(undefined)).toBeNull();
    expect(parseSort("")).toBeNull();
    expect(parseSort("-")).toBeNull();
    expect(parseSort(7)).toBeNull();
  });

  it("writes what it reads back", () => {
    for (const raw of ["type", "-type"]) expect(sortParam(parseSort(raw))).toBe(raw);
    expect(sortParam(null)).toBeUndefined();
  });
});

describe("columns in the URL", () => {
  it("shows exactly the listed columns, in the listed order, with the pinned one last", () => {
    const layout = layoutFromCols("state,name", columns);
    expect(ids(arrangeColumns(columns, layout).visible)).toEqual(["state", "name", "shell"]);
  });

  it("shows a column that starts hidden when the link lists it", () => {
    const withExtra = [...columns, { id: "ipv6", defaultHidden: true }];
    const layout = layoutFromCols("name,ipv6", withExtra);
    expect(ids(arrangeColumns(withExtra, layout).visible)).toEqual(["name", "ipv6", "shell"]);
  });

  it("ignores ids the table does not have, and a list with none it does", () => {
    expect(ids(arrangeColumns(columns, layoutFromCols("name,gone", columns)).visible)).toEqual([
      "name",
      "shell",
    ]);
    expect(layoutFromCols("gone", columns)).toBeUndefined();
    expect(layoutFromCols(undefined, columns)).toBeUndefined();
  });

  it("writes the visible columns without the pinned one, which is always there", () => {
    const visible = arrangeColumns(columns, { order: [], hidden: ["type"], shown: [] }).visible;
    expect(colsParam(visible)).toBe("name,address,state");
    expect(
      ids(arrangeColumns(columns, layoutFromCols(colsParam(visible), columns)).visible),
    ).toEqual(ids(visible));
  });
});
