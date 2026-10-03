import { describe, expect, test } from "vitest";

import type { ColumnNumbers } from "./columnNumbers.ts";
import { isColumnId, isRevision } from "./ids.ts";
import { placedRows, placedText } from "./placed.ts";

const REVISION = 1;

/** An axis of `values`, `null` for a missing row, at revision 1. */
function axis(id: number, values: readonly (number | null)[]): ColumnNumbers {
  const revision = REVISION;
  if (!isColumnId(id) || !isRevision(revision)) throw new Error("not an id");
  const missing = new Uint8Array(Math.ceil(values.length / 8));
  values.forEach((value, row) => {
    if (value === null) missing[row >> 3] = (missing[row >> 3] ?? 0) | (1 << (row & 7));
  });
  return {
    column: id,
    revision,
    centre: 0,
    values: new Float32Array(values.map((value) => value ?? 0)),
    missing,
  };
}

const words = (value: number): string => value.toLocaleString("en");

describe("placedRows", () => {
  test("places the rows with a finite value on every axis", () => {
    const placed = placedRows(
      [
        axis(1, [1, null, 3, 4, 5, 6, 7, 8, 9]),
        axis(2, [1, 2, Infinity, 4, 5, 6, 7, 8, null]),
        axis(1, [1, null, 3, 4, 5, 6, 7, 8, 9]),
      ],
      9,
    );
    expect([...placed.rows]).toEqual([0b1111_1001, 0]);
    expect(placed.count).toBe(6);
    expect(placed.numRows).toBe(9);
  });

  test("an axis of another number of rows is a defect", () => {
    expect(() => placedRows([axis(1, [1, 2])], 3)).toThrow(/column 1 of 2 rows/);
  });
});

describe("placedText", () => {
  test("says all are drawn when none is left out", () => {
    expect(placedText({ rows: new Uint8Array(), count: 2000, numRows: 2000 }, words)).toBe(
      "Drawing all 2,000 individuals.",
    );
    expect(placedText({ rows: new Uint8Array(), count: 1, numRows: 1 }, words)).toBe(
      "Drawing the one individual.",
    );
  });

  test("counts those without a value on an axis", () => {
    expect(placedText({ rows: new Uint8Array(), count: 1688, numRows: 2000 }, words)).toBe(
      "Drawing 1,688 of 2,000 individuals: 312 have no value on an axis.",
    );
    expect(placedText({ rows: new Uint8Array(), count: 2, numRows: 3 }, words)).toBe(
      "Drawing 2 of 3 individuals: 1 has no value on an axis.",
    );
  });
});
