import { describe, expect, test } from "vitest";

import { rowAt, shownRowsOf } from "./filter.ts";
import type { Shown } from "./filter.ts";
import { isRevision } from "./ids.ts";

function shown(numShown: number, bits: Uint8Array | null): Shown {
  const at = 2;
  if (!isRevision(at)) throw new Error("not a revision");
  return {
    filter: { text: "x", column: null, cell: "part", shown: "matching" },
    at,
    numShown,
    bits,
  };
}

describe("the rows the filter shows", () => {
  test("are the rows of the bits set, in order, at their positions", () => {
    // Rows 1, 3 and 9 of a table of 10.
    const rows = shownRowsOf(shown(3, new Uint8Array([0b1010, 0b10])));
    expect(rows === null ? null : [...rows]).toEqual([1, 3, 9]);
    expect(rowAt(rows, 2)).toBe(9);
    expect(() => rowAt(rows, 3)).toThrow(/defect: no row shown at position 3/);
  });

  test("are every row, the position being the row, with no filter", () => {
    const rows = shownRowsOf(shown(4, null));
    expect(rows).toBeNull();
    expect(rowAt(rows, 3)).toBe(3);
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
