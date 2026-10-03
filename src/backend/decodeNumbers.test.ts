import { describe, expect, test } from "vitest";

import { decodeNumbers } from "./decodeNumbers.ts";

// The bytes below are those the core writes in
// crates/vavilov-core/src/numbers/tests.rs: `height` of the plants, 1.5,
// missing, 2 and 3.25, at revision 1, sent as their distances from 2.375.
const HEIGHT = [
  ...[5, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ...[14, 0, 0, 0, 56, 0, 0, 0],
  ...[1, 0, 0, 0, 0, 0, 0, 0],
  ...[1, 0, 0, 0, 0, 0, 0, 0],
  ...[4, 0, 0, 0, 0, 0, 0, 0],
  ...[0, 0, 0, 0, 0, 0, 3, 0x40],
  ...[0b0000_0010, 0, 0, 0, 0, 0, 0, 0],
  ...[0, 0, 0x60, 0xbf, 0, 0, 0, 0, 0, 0, 0xc0, 0xbe, 0, 0, 0x60, 0x3f],
];

function buffer(bytes: readonly number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

/** HEIGHT with the byte at `at` set to `value`. */
function changed(at: number, value: number): ArrayBuffer {
  const bytes = [...HEIGHT];
  bytes[at] = value;
  return buffer(bytes);
}

describe("decodeNumbers", () => {
  test("a column of four rows, one missing, decodes to its middle, its distances and its bits", () => {
    const numbers = decodeNumbers(buffer(HEIGHT));
    expect(numbers.column).toBe(1);
    expect(numbers.revision).toBe(1);
    expect(numbers.centre).toBe(2.375);
    expect([...numbers.values]).toEqual([-0.875, 0, -0.375, 0.875]);
    expect([...numbers.missing]).toEqual([0b0000_0010]);
  });

  test("a middle that is not finite is a defect", () => {
    // 0x7ff8… is a NaN, 0x7ff0… an infinity.
    const nan = [...HEIGHT];
    nan.splice(56, 8, 0, 0, 0, 0, 0, 0, 0xf8, 0x7f);
    expect(() => decodeNumbers(buffer(nan))).toThrow(/middle of NaN/);
    const infinite = [...HEIGHT];
    infinite.splice(56, 8, 0, 0, 0, 0, 0, 0, 0xf0, 0x7f);
    expect(() => decodeNumbers(buffer(infinite))).toThrow(/middle of Infinity/);
  });

  test("an infinity in a row that is not missing is a value that cannot be drawn", () => {
    // Row 3 holds 0x7f800000, +Infinity.
    const bytes = [...HEIGHT];
    bytes.splice(84, 4, 0, 0, 0x80, 0x7f);
    expect(decodeNumbers(buffer(bytes)).values[3]).toBe(Infinity);
  });

  test("a missing row that holds a value is a defect", () => {
    // Row 1, missing, holds 2.
    expect(() => decodeNumbers(changed(79, 0x40))).toThrow(/row 1 of a numbers part holds 2/);
  });

  test("a NaN is a defect", () => {
    const bytes = [...HEIGHT];
    bytes.splice(72, 4, 0, 0, 0xc0, 0x7f);
    expect(() => decodeNumbers(buffer(bytes))).toThrow(/holds NaN/);
  });

  test("a missing row past the last row is a defect", () => {
    expect(() => decodeNumbers(changed(64, 0b0001_0010))).toThrow(/past its last row/);
  });

  test("a length that does not fit the rows is a defect", () => {
    expect(() => decodeNumbers(changed(48, 5))).toThrow(/numbers part of/);
  });

  test("a byte that should be zero is a defect", () => {
    expect(() => decodeNumbers(changed(36, 1))).toThrow(/bytes 4 to 7/);
    expect(() => decodeNumbers(changed(65, 1))).toThrow(/padding after the missing rows/);
  });

  test("a message of another kind is a defect", () => {
    expect(() => decodeNumbers(changed(0, 3))).toThrow(/kind 3/);
  });
});
