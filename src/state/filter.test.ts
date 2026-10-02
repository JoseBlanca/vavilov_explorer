import { describe, expect, test } from "vitest";

import { rowAt, shownBetween, shownRowsOf } from "./filter.ts";
import type { Shown } from "./filter.ts";
import { isPosition, isRevision, isRowIndex } from "./ids.ts";
import type { Position, RowIndex } from "./ids.ts";

function shown(numShown: number, bits: Uint8Array | null): Shown {
  const at = 2;
  if (!isRevision(at)) throw new Error("not a revision");
  return { at, numShown, bits };
}
function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error("not a row");
  return value;
}
function position(value: number): Position {
  if (!isPosition(value)) throw new Error("not a position");
  return value;
}

describe("the rows the filter shows", () => {
  test("are the rows of the bits set, in order, at their positions", () => {
    // Rows 1, 3 and 9 of a table of 10.
    const rows = shownRowsOf(shown(3, new Uint8Array([0b1010, 0b10])));
    expect(rows === null ? null : [...rows]).toEqual([1, 3, 9]);
    expect(rowAt(rows, position(2))).toBe(9);
    expect(() => rowAt(rows, position(3))).toThrow(/defect: no row shown at position 3/);
  });

  test("are every row, the position being the row, with no filter", () => {
    const rows = shownRowsOf(shown(4, null));
    expect(rows).toBeNull();
    expect(rowAt(rows, position(3))).toBe(3);
  });

  test("that the bits do not hold are a defect", () => {
    expect(() => shownRowsOf(shown(2, new Uint8Array([0b111])))).toThrow(
      /defect: more rows shown than the 2 of the filter/,
    );
    expect(() => shownRowsOf(shown(2, new Uint8Array([0b1])))).toThrow(
      /defect: 1 rows shown, not the 2 of the filter/,
    );
  });
});

describe("the rows shown between two rows", () => {
  test("are those of the range the filter shows, or all of them with no filter", () => {
    // Rows 1, 3 and 9 of a table of 10 shown; from row 9 back to row 2.
    const filtered = shown(3, new Uint8Array([0b1010, 0b10]));
    expect([...shownBetween(10, row(9), row(2), filtered)]).toEqual([0b1000, 0b10]);
    expect([...shownBetween(10, row(2), row(9), shown(10, null))]).toEqual([0b1111_1100, 0b11]);
  });

  test("with no rows shown in the copy are a defect", () => {
    expect(() => shownBetween(10, row(2), row(9), null)).toThrow(
      /defect: a range of rows of a table of 10 rows with no rows shown/,
    );
  });
});
