import { describe, expect, test } from "vitest";

import { editedRows, openedEdit } from "./cellEdit.ts";
import { isColumnId, isRevision, isRowIndex } from "./ids.ts";
import type { ColumnId, Revision, RowIndex } from "./ids.ts";

function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
  return value;
}
function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error("not a row");
  return value;
}
function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}

describe("a cell opened for editing", () => {
  test("starts with the text the cell shows, and the checkbox offered and off", () => {
    const value = { kind: "value", text: "1,5", align: "end" } as const;
    expect(openedEdit(revision(3), row(7), column(2), column(0), value)).toEqual({
      loadedAt: 3,
      row: 7,
      column: 2,
      text: "1,5",
      offersSelected: true,
      toSelected: false,
    });
  });

  test("of a missing value starts empty", () => {
    expect(openedEdit(revision(3), row(7), column(2), column(0), { kind: "missing" }).text).toBe(
      "",
    );
  });

  test("of the first column offers no checkbox, since IDs are edited one at a time", () => {
    const id = { kind: "value", text: "p8", align: "start" } as const;
    expect(openedEdit(revision(3), row(7), column(0), column(0), id).offersSelected).toBe(false);
  });
});

describe("the rows an edit sets", () => {
  const edit = openedEdit(revision(1), row(9), column(2), column(0), { kind: "missing" });
  const selection = new Uint8Array([0b0000_0110, 0b01]);

  test("are its own row while the checkbox is off", () => {
    expect([...editedRows(edit, 10, selection)]).toEqual([0, 0b10]);
  });

  test("are the selection's while it is ticked, a copy of it", () => {
    const rows = editedRows({ ...edit, toSelected: true }, 10, selection);
    expect([...rows]).toEqual([0b0000_0110, 0b01]);
    expect(rows).not.toBe(selection);
  });
});
