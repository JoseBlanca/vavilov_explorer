import { describe, expect, test } from "vitest";

import { hasRow, rangeBits } from "./rowSet.ts";

describe("a set of rows", () => {
  test("of one row has its bit alone, in a byte per 8 rows", () => {
    expect([...rangeBits(9, 3, 3)]).toEqual([0b0000_1000, 0]);
    expect([...rangeBits(9, 8, 8)]).toEqual([0, 0b1]);
  });

  test("of a range has every row between its ends, in either order", () => {
    expect([...rangeBits(12, 6, 9)]).toEqual([0b1100_0000, 0b0011]);
    expect([...rangeBits(12, 9, 6)]).toEqual([0b1100_0000, 0b0011]);
  });

  test("of a table of 8 rows is one byte, and of none no byte", () => {
    expect([...rangeBits(8, 0, 7)]).toEqual([0xff]);
    expect(rangeBits(0, 0, 0).length).toBe(0);
  });

  test("tells whether a row is in it", () => {
    const bits = rangeBits(12, 6, 9);
    expect([5, 6, 9, 10].map((row) => hasRow(bits, row))).toEqual([false, true, true, false]);
  });
});
