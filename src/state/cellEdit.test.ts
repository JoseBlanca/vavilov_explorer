import { describe, expect, test } from "vitest";

import { editedRows, offersSelected, openedEdit, suggestedValues } from "./cellEdit.ts";
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

const NAMES = column(0);

describe("a cell opened for editing", () => {
  test("starts with the text the cell shows, and the checkbox off", () => {
    const value = { kind: "value", text: "1,5", align: "end" } as const;
    expect(openedEdit(revision(3), row(7), column(2), NAMES, value)).toEqual({
      loadedAt: 3,
      row: 7,
      column: 2,
      namesColumn: 0,
      text: "1,5",
      toSelected: false,
    });
  });

  test("of a missing value starts empty", () => {
    expect(openedEdit(revision(3), row(7), column(2), NAMES, { kind: "missing" }).text).toBe("");
  });
});

describe("the checkbox Apply to all selected rows", () => {
  const edit = openedEdit(revision(1), row(9), column(2), NAMES, { kind: "missing" });

  test("is offered when the cell's row is one of a selection of several", () => {
    // Rows 1, 2 and 9 of ten.
    expect(offersSelected(edit, new Uint8Array([0b0000_0110, 0b10]))).toBe(true);
  });

  test("is not offered for a selection of the cell's row alone, or one without it", () => {
    expect(offersSelected(edit, new Uint8Array([0, 0b10]))).toBe(false);
    expect(offersSelected(edit, new Uint8Array([0b0000_0110, 0]))).toBe(false);
    expect(offersSelected(edit, new Uint8Array([0, 0]))).toBe(false);
  });

  test("is not offered in the first column, whose IDs are edited one at a time", () => {
    const id = { ...edit, column: NAMES };
    expect(offersSelected(id, new Uint8Array([0b0000_0110, 0b10]))).toBe(false);
  });
});

describe("the rows an edit sets", () => {
  const edit = openedEdit(revision(1), row(9), column(2), NAMES, { kind: "missing" });
  const selection = new Uint8Array([0b0000_0110, 0b10]);

  test("are its own row while the checkbox is off", () => {
    expect([...editedRows(edit, 10, selection)]).toEqual([0, 0b10]);
  });

  test("are the selection's while it is ticked, a copy of it", () => {
    const rows = editedRows({ ...edit, toSelected: true }, 10, selection);
    expect([...rows]).toEqual([0b0000_0110, 0b10]);
    expect(rows).not.toBe(selection);
  });

  test("are its own row when the checkbox ticked is no longer offered", () => {
    const alone = new Uint8Array([0, 0b10]);
    expect([...editedRows({ ...edit, toSelected: true }, 10, alone)]).toEqual([0, 0b10]);
  });
});

describe("the values a field suggests", () => {
  const values = ["Spain", "Peru", "Spain North"];

  test("are all of them while several fit, or none does, or the text is empty", () => {
    expect(suggestedValues(values, "")).toEqual(values);
    expect(suggestedValues(values, "spa")).toEqual(values);
    expect(suggestedValues(values, "Spain")).toEqual(values);
    expect(suggestedValues(values, "Chile")).toEqual(values);
  });

  test("are none once the one that fits is the text typed", () => {
    expect(suggestedValues(values, "Peru")).toEqual([]);
    expect(suggestedValues(values, "Spain North")).toEqual([]);
  });

  test("are all of them while the one that fits is not yet the text typed", () => {
    expect(suggestedValues(values, "per")).toEqual(values);
    expect(suggestedValues(values, "peru")).toEqual(values);
  });
});
