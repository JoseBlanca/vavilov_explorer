import { describe, expect, test } from "vitest";

import { hasRow, intersection, rangeBits } from "./rowSet.ts";

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

  test("in common with another is the rows in both, or all of it with no other", () => {
    const bits = rangeBits(12, 6, 9);
    expect([...intersection(bits, new Uint8Array([0b0100_0000, 0b1111]))]).toEqual([
      0b0100_0000, 0b0011,
    ]);
    expect([...intersection(bits, null)]).toEqual([0b1100_0000, 0b0011]);
  });

  test("in common with a set of another table is a defect", () => {
    expect(() => intersection(rangeBits(12, 6, 9), new Uint8Array([0xff]))).toThrow(
      /defect: the rows in common of a set of 2 bytes and one of 1/,
    );
  });
});
