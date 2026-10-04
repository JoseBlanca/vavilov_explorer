import { describe, expect, test } from "vitest";

import { MAX_LATITUDE, latitudeOf, longitudeOf, mercatorX, mercatorY } from "./mercator.ts";

describe("the Web Mercator projection", () => {
  test("puts the world from 180° west to 180° east between −1 and 1", () => {
    expect(mercatorX(-180)).toBe(-1);
    expect(mercatorX(0)).toBe(0);
    expect(mercatorX(90)).toBe(0.5);
    expect(longitudeOf(0.5)).toBe(90);
  });

  test("stretches the latitudes towards the poles, and the world is square at 85.05°", () => {
    // ln(tan(45° + 22.5°)) / π = 0.881374 / π, worked out by hand.
    expect(mercatorY(45)).toBeCloseTo(0.280_548, 5);
    expect(mercatorY(-45)).toBeCloseTo(-0.280_548, 5);
    expect(mercatorY(0)).toBeCloseTo(0, 12);
    expect(mercatorY(MAX_LATITUDE)).toBeCloseTo(1, 9);
  });

  test("draws a place nearer a pole on the map's edge", () => {
    expect(mercatorY(90)).toBeCloseTo(1, 9);
    expect(mercatorY(-89.5)).toBeCloseTo(-1, 9);
  });

  test("gives back the latitude of a y", () => {
    expect(latitudeOf(0.280_548)).toBeCloseTo(45, 3);
    expect(latitudeOf(-1)).toBeCloseTo(-MAX_LATITUDE, 6);
  });
});
