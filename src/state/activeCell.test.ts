import { describe, expect, test } from "vitest";

import { moved, positionOf } from "./activeCell.ts";
import type { ActiveCell, Move, ShownRows } from "./activeCell.ts";
import { isColumnId, isRowIndex } from "./ids.ts";
import type { ColumnId, RowIndex } from "./ids.ts";

function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error("not a row");
  return value;
}
function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}

/** Rows 1, 4, 5 and 9 of a table of ten shown. */
const FILTERED: ShownRows = { numShown: 4, rows: new Uint32Array([1, 4, 5, 9]) };
/** Every row of a table of ten. */
const ALL: ShownRows = { numShown: 10, rows: null };
const COLUMNS = [column(0), column(3), column(1)];
const cell = (r: number, c: number): ActiveCell => ({ row: row(r), column: column(c) });

describe("the position of a row among those shown", () => {
  test("is its row when every row is shown", () => {
    expect(positionOf(row(7), ALL)).toBe(7);
    expect(positionOf(row(10), ALL)).toBeNull();
  });

  test("is its place among the rows the filter shows, and none for a row it hides", () => {
    expect([1, 4, 5, 9].map((r) => positionOf(row(r), FILTERED))).toEqual([0, 1, 2, 3]);
    expect([0, 2, 6, 10].map((r) => positionOf(row(r), FILTERED))).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("a key on the table", () => {
  const move = (from: ActiveCell | null, key: Move, shown = FILTERED): ActiveCell | null =>
    moved(from, key, COLUMNS, shown, 2);

  test("moves to the row above or below among those shown, and stops at the ends", () => {
    expect(move(cell(4, 3), "down")).toEqual(cell(5, 3));
    expect(move(cell(4, 3), "up")).toEqual(cell(1, 3));
    expect(move(cell(1, 3), "up")).toEqual(cell(1, 3));
    expect(move(cell(9, 3), "down")).toEqual(cell(9, 3));
  });

  test("moves to the column beside, in the order of the table, and stops at the ends", () => {
    expect(move(cell(4, 3), "right")).toEqual(cell(4, 1));
    expect(move(cell(4, 3), "left")).toEqual(cell(4, 0));
    expect(move(cell(4, 0), "left")).toEqual(cell(4, 0));
    expect(move(cell(4, 1), "right")).toEqual(cell(4, 1));
    expect(move(cell(4, 1), "home")).toEqual(cell(4, 0));
    expect(move(cell(4, 0), "end")).toEqual(cell(4, 1));
  });

  test("moves a page of rows, and stops at the ends", () => {
    expect(move(cell(1, 1), "pageDown")).toEqual(cell(5, 1));
    expect(move(cell(5, 1), "pageDown")).toEqual(cell(9, 1));
    expect(move(cell(4, 1), "pageUp")).toEqual(cell(1, 1));
    expect(move(cell(7, 0), "pageDown", ALL)).toEqual(cell(9, 0));
  });

  test("starts at the first cell of the first row shown, also when the cell's row is hidden", () => {
    expect(move(null, "down")).toEqual(cell(1, 0));
    expect(move(cell(2, 3), "down")).toEqual(cell(1, 0));
    expect(move(cell(4, 99), "down")).toEqual(cell(1, 0));
  });

  test("goes nowhere when no row is shown", () => {
    expect(move(cell(4, 3), "down", { numShown: 0, rows: new Uint32Array([]) })).toBeNull();
  });
});
