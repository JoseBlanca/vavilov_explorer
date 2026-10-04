import { describe, expect, test } from "vitest";

import atlas from "world-atlas/countries-50m.json?raw";

import { at } from "../state/at.ts";
import { mercatorX, mercatorY } from "./mercator.ts";
import { countryAt, outlineOf, worldShapes } from "./worldShapes.ts";
import type { CountryShape } from "./worldShapes.ts";

/**
 * A small world in TopoJSON with no transform, whose arcs are degrees: a
 * square country, 001; a country, 002, with a hole that a third, 003,
 * fills; a country across 180°, 004, whose ring jumps from 175° to −175° as
 * Natural Earth writes them; a ring around the south pole, 005, as
 * Antarctica's; and a shape with no ISO code, as Kosovo's.
 */
const TOPOLOGY = {
  type: "Topology",
  arcs: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [20, 0],
      [40, 0],
      [40, 20],
      [20, 20],
      [20, 0],
    ],
    [
      [25, 5],
      [25, 10],
      [30, 10],
      [30, 5],
      [25, 5],
    ],
    [
      [175, -10],
      [-175, -10],
      [-175, 10],
      [175, 10],
      [175, -10],
    ],
    [
      [-180, -70],
      [-60, -72],
      [60, -70],
      [179, -71],
      [-180, -70],
    ],
    [
      [50, 50],
      [51, 50],
      [51, 51],
      [50, 50],
    ],
    [
      [-175, 20],
      [175, 20],
      [175, 30],
      [-175, 30],
      [-175, 20],
    ],
    [
      [0, 86],
      [10, 86],
      [10, 88],
      [0, 86],
    ],
  ],
  objects: {
    countries: {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", arcs: [[0]], id: "001", properties: { name: "Square" } },
        { type: "Polygon", arcs: [[1], [2]], id: "002", properties: { name: "Ring" } },
        { type: "Polygon", arcs: [[~2]], id: "003", properties: { name: "Hole" } },
        { type: "MultiPolygon", arcs: [[[3]]], id: "004", properties: { name: "Across" } },
        { type: "Polygon", arcs: [[4]], id: "005", properties: { name: "Pole" } },
        { type: "Polygon", arcs: [[5]], properties: { name: "No code" } },
        { type: "Polygon", arcs: [[6]], id: "006", properties: { name: "Westward" } },
        { type: "Polygon", arcs: [[7]], id: "007", properties: { name: "Far north" } },
      ],
    },
  },
};

/** The numeric code of the country at `latitude`, `longitude` in degrees, or `null`. */
function codeAt(
  countries: readonly CountryShape[],
  latitude: number,
  longitude: number,
): string | null {
  const index = countryAt(countries, mercatorX(longitude), mercatorY(latitude));
  return index === null ? null : at(countries, index).numeric;
}

/** The area of the triangles `x0, y0, x1, y1, x2, y2, …`. */
function areaOf(triangles: Float32Array): number {
  let area = 0;
  for (let index = 0; index + 5 < triangles.length; index += 6) {
    const [x0, y0, x1, y1, x2, y2] = triangles.subarray(index, index + 6);
    if (x0 === undefined || y0 === undefined || x1 === undefined) continue;
    if (y1 === undefined || x2 === undefined || y2 === undefined) continue;
    area += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
  }
  return area;
}

describe("the shapes of a small world", () => {
  const shapes = worldShapes(TOPOLOGY);

  test("are the countries in the order of the data, with their codes and names", () => {
    expect(shapes.countries.map((country) => [country.numeric, country.name])).toEqual([
      ["001", "Square"],
      ["002", "Ring"],
      ["003", "Hole"],
      ["004", "Across"],
      ["005", "Pole"],
      [null, "No code"],
      ["006", "Westward"],
      ["007", "Far north"],
    ]);
  });

  test("keep a shape with no ISO code, which is filled and found as the others are", () => {
    const index = countryAt(shapes.countries, mercatorX(50.8), mercatorY(50.2));
    expect(index === null ? null : shapes.countries[index]?.name).toBe("No code");
  });

  test("draw each border once and skip the segments that jump across 180°", () => {
    // 4 sides of each of the three squares, 2 of the 4 of each country
    // across 180°, 3 of the 4 around the pole, 3 of the shape with no code
    // and 3 of the one in the far north.
    expect(shapes.borders.length).toBe(4 * (4 + 4 + 4 + 2 + 3 + 3 + 2 + 3));
    // The first side of the square, from 0° to 10° east along the equator.
    const [x0, y0, x1, y1] = shapes.borders;
    expect(x0).toBeCloseTo(0, 9);
    expect(y0).toBeCloseTo(0, 9);
    expect(x1).toBeCloseTo(mercatorX(10), 7);
    expect(y1).toBeCloseTo(0, 9);
  });

  test("find the country under a place, a hole's own country inside the hole", () => {
    expect(codeAt(shapes.countries, 5, 5)).toBe("001");
    expect(codeAt(shapes.countries, 15, 35)).toBe("002");
    expect(codeAt(shapes.countries, 7, 27)).toBe("003");
    expect(codeAt(shapes.countries, 5, 15)).toBe(null);
  });

  test("put a country across 180° on both edges of the map", () => {
    expect(codeAt(shapes.countries, 0, 177)).toBe("004");
    expect(codeAt(shapes.countries, 0, -177)).toBe("004");
    expect(codeAt(shapes.countries, 0, 170)).toBe(null);
    expect(codeAt(shapes.countries, 0, -170)).toBe(null);
  });

  test("put a country that crosses 180° going west on both edges too", () => {
    expect(codeAt(shapes.countries, 25, -177)).toBe("006");
    expect(codeAt(shapes.countries, 25, 177)).toBe("006");
    expect(codeAt(shapes.countries, 25, -170)).toBe(null);
  });

  test("leave out a ring wholly beyond 85.05°, which the map has no room for", () => {
    const farNorth = shapes.countries.find((country) => country.numeric === "007");
    expect(farNorth?.polygons).toEqual([]);
    expect(farNorth?.triangles.length).toBe(0);
  });

  test("close a ring around the pole along the map's edge", () => {
    expect(codeAt(shapes.countries, -80, 0)).toBe("005");
    expect(codeAt(shapes.countries, -89, 120)).toBe("005");
    expect(codeAt(shapes.countries, -60, 0)).toBe(null);
  });

  test("fill a country with triangles of its area, and a hole with none", () => {
    const [square, ring] = shapes.countries;
    const squareArea = mercatorX(10) * mercatorY(10);
    const outer = (mercatorX(40) - mercatorX(20)) * mercatorY(20);
    const hole = (mercatorX(30) - mercatorX(25)) * (mercatorY(10) - mercatorY(5));
    expect(areaOf(square?.triangles ?? new Float32Array())).toBeCloseTo(squareArea, 6);
    expect(areaOf(ring?.triangles ?? new Float32Array())).toBeCloseTo(outer - hole, 6);
  });

  test("outline a country along its rings, as many sides as they have", () => {
    const [square] = shapes.countries;
    if (square === undefined) throw new Error("no square");
    // The ring repeats its first point last: four sides, four numbers each.
    expect(outlineOf(square).length).toBe(4 * 4);
  });

  test("do not outline the map's edge where a country was cut at 180° or closed at a pole", () => {
    const onEdge = (segments: Float32Array, axis: 0 | 1, edge: number): number => {
      let count = 0;
      for (let index = 0; index + 3 < segments.length; index += 4) {
        const a = segments[index + axis] ?? Number.NaN;
        const b = segments[index + 2 + axis] ?? Number.NaN;
        if (Math.abs(Math.abs(a) - edge) < 1e-9 && Math.abs(Math.abs(b) - edge) < 1e-9) count += 1;
      }
      return count;
    };
    const across = shapes.countries[3];
    const pole = shapes.countries[4];
    if (across === undefined || pole === undefined) throw new Error("no such country");
    expect(onEdge(outlineOf(across), 0, 1)).toBe(0);
    expect(onEdge(outlineOf(pole), 1, 1)).toBe(0);
    // Each half keeps its bottom, its top and its side away from the edge.
    expect(outlineOf(across).length).toBe(6 * 4);
  });

  test("of a country across 180° fill its two halves, cut at the edges", () => {
    const across = shapes.countries[3];
    const half = (mercatorX(180) - mercatorX(175)) * (mercatorY(10) - mercatorY(-10));
    expect(areaOf(across?.triangles ?? new Float32Array())).toBeCloseTo(2 * half, 6);
  });
});

describe("the shapes of world-atlas", () => {
  const shapes = worldShapes(JSON.parse(atlas));

  test("put places in their countries, by their ISO numeric codes", () => {
    expect(codeAt(shapes.countries, 40.4, -3.7)).toBe("724"); // Madrid, Spain
    expect(codeAt(shapes.countries, 48.9, 2.35)).toBe("250"); // Paris, France
    expect(codeAt(shapes.countries, -29.5, 28.2)).toBe("426"); // Lesotho, inside South Africa
    expect(codeAt(shapes.countries, -26, 28)).toBe("710"); // Johannesburg, South Africa
    expect(codeAt(shapes.countries, 30, -40)).toBe(null); // the Atlantic
  });

  test("draw French Guiana as part of France, which has its own numeric code", () => {
    expect(codeAt(shapes.countries, 4, -53)).toBe("250");
    expect(shapes.countries.some((country) => country.numeric === "254")).toBe(false);
  });

  test("put both sides of Chukotka, across 180°, and Antarctica in theirs", () => {
    expect(codeAt(shapes.countries, 66, 175)).toBe("643");
    expect(codeAt(shapes.countries, 66, -175)).toBe("643");
    expect(codeAt(shapes.countries, -80, 0)).toBe("010");
  });
});
