import { describe, expect, test } from "vitest";

import {
  hasRow,
  intersection,
  onlyRow,
  rangeBits,
  rowsWhere,
  toggledRow,
  toggledRows,
} from "./rowSet.ts";

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

describe("rowsWhere, onlyRow and toggledRow", () => {
  test("build the set of the rows that pass, one row alone, and a set with a row toggled", () => {
    expect([...rowsWhere(10, (row) => row % 3 === 0)]).toEqual([0b0100_1001, 0b10]);
    expect([...onlyRow(10, 9)]).toEqual([0, 0b10]);
    const bits = new Uint8Array([0b1, 0b10]);
    expect([...toggledRow(bits, 9)]).toEqual([0b1, 0]);
    expect([...toggledRow(bits, 3)]).toEqual([0b1001, 0b10]);
    expect([...bits]).toEqual([0b1, 0b10]);
  });

  test("a row past the set is a defect", () => {
    expect(() => onlyRow(8, 8)).toThrow(/row 8 in a set of 8 rows/);
    expect(() => toggledRow(new Uint8Array(1), 8)).toThrow(/row 8 in a set of 1 bytes/);
  });
});

describe("toggledRows", () => {
  test("adds the rows to the set unless all of them are in it", () => {
    const bits = new Uint8Array([0b0000_0011, 0]);
    expect([...toggledRows(bits, new Uint8Array([0b0000_0110, 0b1]))]).toEqual([0b0000_0111, 0b1]);
  });

  test("takes the rows away when all of them are in the set", () => {
    const bits = new Uint8Array([0b0000_0111, 0b1]);
    expect([...toggledRows(bits, new Uint8Array([0b0000_0110, 0b1]))]).toEqual([0b0000_0001, 0]);
  });

  test("of sets of another length is a defect", () => {
    expect(() => toggledRows(new Uint8Array(2), new Uint8Array(1))).toThrow(
      /defect: the rows of a set of 1 bytes toggled in one of 2/,
    );
  });
});
