import { describe, expect, test } from "vitest";

import { niceTicks, rangeOf, sceneMaps } from "./axes.ts";

/** `actual` is the map `expected`, to twelve decimals. */
function expectMap(
  actual: { centre: number; scale: number; half: number } | undefined,
  expected: { centre: number; scale: number; half: number },
): void {
  expect(actual?.centre).toBeCloseTo(expected.centre, 12);
  expect(actual?.scale).toBeCloseTo(expected.scale, 12);
  expect(actual?.half).toBeCloseTo(expected.half, 12);
}

describe("sceneMaps", () => {
  test("keeps the proportions of axes within 4 times of each other, the longest −1 to 1", () => {
    const [x, y, z] = sceneMaps([
      { min: 0, max: 10 },
      { min: -5, max: 5 },
      { min: 2, max: 7 },
    ]);
    expectMap(x, { centre: 5, scale: 0.2, half: 1 });
    expectMap(y, { centre: 0, scale: 0.2, half: 1 });
    expectMap(z, { centre: 4.5, scale: 0.2, half: 0.5 });
  });

  test("stretches every axis to the same length past 4 times", () => {
    const [x, y] = sceneMaps([
      { min: 0, max: 100 },
      { min: 0, max: 1 },
      { min: 0, max: 100 },
    ]);
    expect(x?.half).toBeCloseTo(1, 12);
    expect(y?.half).toBeCloseTo(1, 12);
    expect(y?.scale).toBeCloseTo(2, 12);
  });

  test("gives an axis of one value a length", () => {
    const [x] = sceneMaps([
      { min: 3, max: 3 },
      { min: 0, max: 3 },
      { min: 0, max: 3 },
    ]);
    expectMap(x, { centre: 3, scale: 0.666666666667, half: 1 });
  });

  test("a range that is not finite is a defect", () => {
    expect(() => sceneMaps([{ min: 0, max: Infinity }])).toThrow(/an axis from 0 to Infinity/);
  });
});

describe("niceTicks", () => {
  test("are round values within the range", () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    // A step of 0.28 is nearest 0.25, on a scale of logarithms.
    expect(niceTicks(-0.43, 0.97)).toEqual([-0.25, 0, 0.25, 0.5, 0.75]);
    expect(niceTicks(0.1, 0.35)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
  });

  test("are the one value of an axis of one value", () => {
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  test("keep the round values at both ends of a range read as 32-bit floats", () => {
    // 1.6 as a 32-bit float is 1.6000000238, and 1.9 is 1.8999999762.
    expect(niceTicks(Math.fround(1.6), Math.fround(1.9))).toEqual([
      1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9,
    ]);
    expect(niceTicks(-19.9, -19.4)).toEqual([-19.9, -19.8, -19.7, -19.6, -19.5, -19.4]);
  });

  test("stay within the range of values far from zero and close together", () => {
    expect(niceTicks(4500000.25, 4500000.75)).toEqual([
      4500000.3, 4500000.4, 4500000.5, 4500000.6, 4500000.7,
    ]);
  });
});

describe("rangeOf", () => {
  test("is the range of the rows placed, and none with none placed", () => {
    const values = new Float32Array([5, -1, 9, 2]);
    expect(rangeOf(values, new Uint8Array([0b1011]))).toEqual({ min: -1, max: 5 });
    expect(rangeOf(values, new Uint8Array([0]))).toBe(null);
  });
});
