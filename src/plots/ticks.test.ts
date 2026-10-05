import { describe, expect, test } from "vitest";

import { roundTick, roundTicks } from "./ticks.ts";

describe("the value of a tick", () => {
  test("keeps the digits its step needs, and drops the error of the binary sum", () => {
    // d3 places a tick at i × step, which above 10^22 is off in its last bits.
    expect(roundTick(1.4999999999999999e23, 5e22)).toBe(1.5e23);
    expect(roundTick(9.999999999999999e29, 2e29)).toBe(1e30);
    expect(roundTick(0.30000000000000004, 0.1)).toBe(0.3);
  });

  test("keeps every digit a value far from zero and close to the next tick needs", () => {
    // 13 significant digits, one more than a rounding to 12 keeps.
    expect(roundTick(123456789.12350003, 0.0001)).toBe(123456789.1235);
    expect(roundTick(-123456789.12350003, 0.0001)).toBe(-123456789.1235);
  });

  test("is 0 for a value nearer 0 than half its step", () => {
    expect(roundTick(5.551115123125783e-17, 0.1)).toBe(0);
    expect(roundTick(0, 5e22)).toBe(0);
  });
});

describe("the values of the ticks of an axis", () => {
  test("are rounded to the step between the first two", () => {
    expect(
      roundTicks([0, 4.9999999999999994e29, 9.999999999999999e29, 1.5e30, 1.9999999999999998e30]),
    ).toEqual([0, 5e29, 1e30, 1.5e30, 2e30]);
  });

  test("of one tick, or none, are as given", () => {
    expect(roundTicks([1.4999999999999999e23])).toEqual([1.4999999999999999e23]);
    expect(roundTicks([])).toEqual([]);
  });
});
