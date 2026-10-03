import { describe, expect, test } from "vitest";

import { insidePolygon, pickPoint, pointsInPolygon, projectPoints } from "./projection.ts";

/** The identity: clip space is the scene, and w is 1. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A matrix whose w is −z, as a camera looking down −z has: a point at z = 1 is behind it. */
const PERSPECTIVE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0];

/** Each of `actual` is `expected`'s, to nine decimals; NaN and the infinities exactly. */
function expectClose(actual: ArrayLike<number>, expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, index) => {
    const got = actual[index];
    if (Number.isFinite(value)) {
      expect(got).toBeCloseTo(value, 9);
    } else {
      expect(got).toBe(value);
    }
  });
}

describe("projectPoints", () => {
  test("places clip space on the canvas, y down, and gives the depth", () => {
    const screen = projectPoints(
      IDENTITY,
      new Float32Array([0, 0, 0.5, -1, 1, -0.5, 1, -1, 0]),
      new Float32Array([6, 6, 6]),
      200,
      100,
    );
    expectClose(screen.xy, [100, 50, 0, 0, 200, 100]);
    expectClose(screen.depth, [0.5, -0.5, 0]);
  });

  test("gives no place to a point not drawn or behind the camera", () => {
    const screen = projectPoints(
      PERSPECTIVE,
      new Float32Array([1, 1, -2, 0, 0, 1, 0, 0, -1]),
      new Float32Array([6, 6, 0]),
      200,
      100,
    );
    expectClose(screen.xy, [150, 25, NaN, NaN, NaN, NaN]);
    expectClose(screen.depth, [-1, Infinity, Infinity]);
  });
});

describe("pickPoint", () => {
  const screen = {
    xy: new Float32Array([10, 10, 13, 10, 50, 50, NaN, NaN]),
    depth: new Float32Array([0.5, 0.2, 0.1, Infinity]),
  };
  const sizes = new Float32Array([6, 6, 6, 0]);

  test("is the nearest the camera of the points under the pointer", () => {
    expect(pickPoint(screen, sizes, 11, 10, 3)).toBe(1);
  });

  test("reaches the size's radius plus the slop, and no further", () => {
    expect(pickPoint(screen, sizes, 50, 56, 3)).toBe(2);
    expect(pickPoint(screen, sizes, 50, 56.5, 3)).toBe(null);
  });
});

describe("insidePolygon and pointsInPolygon", () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];

  test("a point inside a square is in, one outside is out", () => {
    expect(insidePolygon(square, 5, 5)).toBe(true);
    expect(insidePolygon(square, 15, 5)).toBe(false);
  });

  test("a lasso that crosses itself holds what the even and odd rule says", () => {
    const bowtie = [0, 0, 10, 10, 10, 0, 0, 10];
    expect(insidePolygon(bowtie, 2, 5)).toBe(true);
    expect(insidePolygon(bowtie, 5, 2)).toBe(false);
  });

  test("gives the points drawn inside, as bits", () => {
    const screen = {
      xy: new Float32Array([5, 5, 15, 5, NaN, NaN, 1, 9, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]),
      depth: new Float32Array(9),
    };
    expect([...pointsInPolygon(screen, square)]).toEqual([0b1111_1001, 0b1]);
  });
});
