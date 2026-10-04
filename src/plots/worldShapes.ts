// The borders and the countries of the map, from the Natural Earth data of
// world-atlas in TopoJSON, in the units of the scene (mercator.ts): the
// borders as line segments, each shared border once, and each country as
// its rings and the triangles that fill it (frontend.md, "The point
// views"; docs/prototype-lessons.md, "Map").

import * as THREE from "three";
import { feature, mesh } from "topojson-client";

import { at } from "../state/at.ts";
import { defect } from "../state/defect.ts";
import { MAX_LATITUDE, mercatorX, mercatorY } from "./mercator.ts";
import { insidePolygon } from "./projection.ts";

/** A box in the scene. */
export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** One polygon of a country in the scene: its outer ring, then its holes. */
export interface ScenePolygon {
  /** Each ring as `x0, y0, x1, y1, …`, the outer one first. */
  readonly rings: readonly (readonly number[])[];
  /** The box around the outer ring. */
  readonly box: Box;
}

/** A country of the map. */
export interface CountryShape {
  /**
   * Its ISO numeric code, three digits, as world-atlas names it; `null` for
   * a shape ISO has no code for, Somaliland, Kosovo, N. Cyprus, the Siachen
   * Glacier and the Indian Ocean Territories, which no individual is in
   * and which are drawn as a country of none.
   */
  readonly numeric: string | null;
  /** Its name in Natural Earth's data, shorter than ISO's: `Bolivia`. */
  readonly name: string;
  /** Its polygons, those cut at 180° among them. */
  readonly polygons: readonly ScenePolygon[];
  /** The triangles that fill it, `x0, y0, x1, y1, x2, y2` for each. */
  readonly triangles: Float32Array;
}

/** The borders and the countries of the map. */
export interface WorldShapes {
  /** The borders and coasts as segments, `x0, y0, x1, y1` for each. */
  readonly borders: Float32Array;
  /** The countries, in the order of the data. */
  readonly countries: readonly CountryShape[];
}

/** A place in degrees, longitude then latitude, as GeoJSON writes it. */
type LonLat = readonly [number, number];

/** A polygon in degrees: its outer ring, then its holes. */
type Rings = readonly (readonly LonLat[])[];

/** A ring of the scene, `x0, y0, x1, y1, …`. */
type Ring = readonly number[];

/** The shapes of the TopoJSON `topology`, whose countries are its object `countries`. */
export function worldShapes(topology: unknown): WorldShapes {
  const object = countriesOf(topology);
  const borders = bordersOf(linesOf(mesh(topology, object)));
  const countries = featuresOf(feature(topology, object)).map(({ numeric, name, polygons }) => {
    const scene = polygons.flatMap(planarPolygons).flatMap(cutAt180);
    return { numeric, name, polygons: scene.map(withBox), triangles: trianglesOf(scene) };
  });
  return { borders, countries };
}

/**
 * The index of the country under `x`, `y` of the scene in `countries`, or
 * `null` for none: inside the outer ring of one of its polygons and in
 * none of its holes.
 */
export function countryAt(countries: readonly CountryShape[], x: number, y: number): number | null {
  const index = countries.findIndex((country) =>
    country.polygons.some(({ rings, box }) => {
      if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) {
        return false;
      }
      const [outer, ...holes] = rings;
      return (
        outer !== undefined &&
        insidePolygon(outer, x, y) &&
        !holes.some((hole) => insidePolygon(hole, x, y))
      );
    }),
  );
  return index === -1 ? null : index;
}

/** How near ±1 a coordinate of the scene is on the edge of the map: far below a pixel at any zoom. */
const EDGE_TOLERANCE = 1e-9;

/**
 * The outline of `country` in the scene, `x0, y0, x1, y1` for each side of
 * its rings, but the sides along the edge of the map, where a country
 * across 180° was cut or a ring round a pole closed.
 */
export function outlineOf(country: CountryShape): Float32Array {
  const segments: number[] = [];
  // The poles are projected to ±1 within the rounding of the logarithm.
  const atEdge = (value: number): boolean => Math.abs(Math.abs(value) - 1) < EDGE_TOLERANCE;
  const onEdge = (a: number, b: number): boolean =>
    atEdge(a) && atEdge(b) && Math.sign(a) === Math.sign(b);
  for (const polygon of country.polygons) {
    for (const ring of polygon.rings) {
      const count = ring.length / 2;
      for (let point = 0; point < count; point += 1) {
        const next = (point + 1) % count;
        const x0 = at(ring, 2 * point);
        const y0 = at(ring, 2 * point + 1);
        const x1 = at(ring, 2 * next);
        const y1 = at(ring, 2 * next + 1);
        const nowhere = x0 === x1 && y0 === y1;
        if (!nowhere && !onEdge(x0, x1) && !onEdge(y0, y1)) {
          segments.push(x0, y0, x1, y1);
        }
      }
    }
  }
  return new Float32Array(segments);
}

/** The segments of `lines` in the scene, but those that jump more than 180° in longitude. */
function bordersOf(lines: readonly (readonly LonLat[])[]): Float32Array {
  const segments: number[] = [];
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const [lon0, lat0] = at(line, index - 1);
      const [lon1, lat1] = at(line, index);
      // Fiji and Chukotka cross 180°, and would draw a line across the world.
      if (Math.abs(lon1 - lon0) <= 180) {
        segments.push(mercatorX(lon0), mercatorY(lat0), mercatorX(lon1), mercatorY(lat1));
      }
    }
  }
  return new Float32Array(segments);
}

/**
 * `ring` with each longitude moved by 360° to within 180° of the one
 * before, so that a ring across 180° runs on past it instead of jumping
 * back across the world.
 */
function unwrapped(ring: readonly LonLat[]): LonLat[] {
  const result: LonLat[] = [];
  let previous: number | null = null;
  for (const [lon, lat] of ring) {
    let moved = lon;
    if (previous !== null) {
      while (moved - previous > 180) moved -= 360;
      while (previous - moved > 180) moved += 360;
    }
    result.push([moved, lat]);
    previous = moved;
  }
  return result;
}

/** Whether `ring`, unwrapped, goes all the way round the world, as Antarctica's coast does. */
function circlesThePole(ring: readonly LonLat[]): boolean {
  const longitudes = ring.map(([lon]) => lon);
  return Math.max(...longitudes) - Math.min(...longitudes) >= 359;
}

/** Whether every place of `ring` is nearer a pole than the map draws, which leaves it no area. */
function beyondTheMap(ring: readonly LonLat[]): boolean {
  return ring.every(([, lat]) => Math.abs(lat) >= MAX_LATITUDE);
}

/**
 * The polygons in the plane of a polygon of the sphere: a ring that goes
 * round the world is closed along the edge of the map at its pole and is a
 * polygon of its own, a ring the map cannot draw is left out, and the
 * others keep their outer ring and holes.
 */
function planarPolygons(polygon: Rings): Rings[] {
  const result: Rings[] = [];
  const kept: LonLat[][] = [];
  polygon.forEach((given, index) => {
    const ring = unwrapped(given);
    if (beyondTheMap(ring)) {
      return;
    }
    if (circlesThePole(ring)) {
      const first = at(ring, 0);
      const last = at(ring, ring.length - 1);
      const meanLatitude = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
      const pole = meanLatitude < 0 ? -90 : 90;
      result.push([[...ring, [last[0], pole], [first[0], pole], first]]);
      return;
    }
    if (index === 0 || kept.length > 0) {
      kept.push(ring);
      return;
    }
    throw defect("a polygon of the map whose holes have no outer ring");
  });
  if (kept.length > 0) {
    result.push(kept);
  }
  return result;
}

/**
 * A polygon in degrees as rings of the scene, cut where it runs past 180°
 * east or west, and the part beyond moved to the other edge of the map.
 */
function cutAt180(polygon: Rings): (readonly Ring[])[] {
  const scene = polygon.map((ring) =>
    ring.flatMap(([lon, lat]) => [mercatorX(lon), mercatorY(lat)]),
  );
  const outer = at(scene, 0);
  const xs = outer.filter((_, index) => index % 2 === 0);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const parts: (readonly Ring[])[] = [];
  const keep = (rings: readonly Ring[]): void => {
    const [kept, ...holes] = rings;
    if (kept !== undefined && kept.length >= 6) {
      parts.push([kept, ...holes.filter((hole) => hole.length >= 6)]);
    }
  };
  if (maxX > 1) {
    keep(scene.map((ring) => clipped(ring, (x) => x <= 1, 1)));
    keep(
      scene.map((ring) =>
        shifted(
          clipped(ring, (x) => x >= 1, 1),
          -2,
        ),
      ),
    );
  } else if (minX < -1) {
    keep(scene.map((ring) => clipped(ring, (x) => x >= -1, -1)));
    keep(
      scene.map((ring) =>
        shifted(
          clipped(ring, (x) => x <= -1, -1),
          2,
        ),
      ),
    );
  } else {
    keep(scene);
  }
  return parts;
}

/**
 * The part of `ring` on the side of the line x = `edge` that `inside`
 * keeps, by the clipping of Sutherland and Hodgman, which cuts each edge
 * that crosses the line where it crosses it.
 */
function clipped(ring: Ring, inside: (x: number) => boolean, edge: number): Ring {
  const result: number[] = [];
  const count = ring.length / 2;
  for (let index = 0; index < count; index += 1) {
    const x0 = at(ring, 2 * index);
    const y0 = at(ring, 2 * index + 1);
    const next = (index + 1) % count;
    const x1 = at(ring, 2 * next);
    const y1 = at(ring, 2 * next + 1);
    if (inside(x0)) {
      result.push(x0, y0);
    }
    if (inside(x0) !== inside(x1)) {
      result.push(edge, y0 + ((y1 - y0) * (edge - x0)) / (x1 - x0));
    }
  }
  return result;
}

/** `ring` moved by `dx` along x. */
function shifted(ring: Ring, dx: number): Ring {
  return ring.map((value, index) => (index % 2 === 0 ? value + dx : value));
}

/** A polygon of the scene with the box of its outer ring. */
function withBox(rings: readonly Ring[]): ScenePolygon {
  const outer = at(rings, 0);
  const xs = outer.filter((_, index) => index % 2 === 0);
  const ys = outer.filter((_, index) => index % 2 === 1);
  return {
    rings,
    box: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
  };
}

/** The triangles that fill `polygons`, their holes left empty, by Three.js's ear clipping. */
function trianglesOf(polygons: readonly (readonly Ring[])[]): Float32Array {
  const triangles: number[] = [];
  for (const rings of polygons) {
    const points = rings.map((ring) => {
      const vectors: THREE.Vector2[] = [];
      for (let index = 0; index + 1 < ring.length; index += 2) {
        vectors.push(new THREE.Vector2(at(ring, index), at(ring, index + 1)));
      }
      return vectors;
    });
    const [outer, ...holes] = points;
    if (outer === undefined) {
      continue;
    }
    // It drops the last point of a ring that repeats the first, in place.
    const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
    const all = [...outer, ...holes.flat()];
    for (const face of faces) {
      for (const corner of face) {
        const point = at(all, corner);
        triangles.push(point.x, point.y);
      }
    }
  }
  return new Float32Array(triangles);
}

/** The object `countries` of a TopoJSON topology. */
function countriesOf(topology: unknown): unknown {
  if (!isRecord(topology) || !isRecord(topology["objects"])) {
    throw defect("a map's borders with no objects");
  }
  const countries = topology["objects"]["countries"];
  if (countries === undefined) {
    throw defect("a map's borders with no countries");
  }
  return countries;
}

/** The lines of a GeoJSON MultiLineString. */
function linesOf(value: unknown): LonLat[][] {
  if (!isRecord(value) || value["type"] !== "MultiLineString") {
    throw defect("a map's borders that are no MultiLineString");
  }
  return listOf(value["coordinates"], "the lines of the borders").map((line) =>
    listOf(line, "a line of the borders").map(lonLatOf),
  );
}

/**
 * Each feature of a GeoJSON FeatureCollection: its ISO numeric code or
 * `null`, its name and its polygons.
 */
function featuresOf(value: unknown): { numeric: string | null; name: string; polygons: Rings[] }[] {
  if (!isRecord(value) || value["type"] !== "FeatureCollection") {
    throw defect("a map's countries that are no FeatureCollection");
  }
  return listOf(value["features"], "the countries").map((country) => {
    if (!isRecord(country)) {
      throw defect("a country of the map that is no feature");
    }
    const id = country["id"];
    if (id !== undefined && (typeof id !== "string" || !/^[0-9]{3}$/.test(id))) {
      throw defect(`a country of the map with the id ${JSON.stringify(id)}`);
    }
    const properties = country["properties"];
    const name = isRecord(properties) ? properties["name"] : undefined;
    if (typeof name !== "string") {
      throw defect(`a country of the map, ${String(id)}, with no name`);
    }
    return { numeric: id ?? null, name, polygons: polygonsOf(country["geometry"]) };
  });
}

/** The polygons of a GeoJSON Polygon or MultiPolygon, or none for no geometry. */
function polygonsOf(geometry: unknown): Rings[] {
  if (geometry === null) {
    return [];
  }
  if (!isRecord(geometry)) {
    throw defect("a country of the map whose geometry is no object");
  }
  const rings = (polygon: unknown): Rings =>
    listOf(polygon, "a polygon").map((ring) => listOf(ring, "a ring").map(lonLatOf));
  switch (geometry["type"]) {
    case "Polygon":
      return [rings(geometry["coordinates"])];
    case "MultiPolygon":
      return listOf(geometry["coordinates"], "a MultiPolygon").map(rings);
    default:
      throw defect(`a country of the map of the geometry ${String(geometry["type"])}`);
  }
}

function lonLatOf(value: unknown): LonLat {
  const [lon, lat] = listOf(value, "a place");
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon + lat)) {
    throw defect("a place of the map that is not two numbers");
  }
  return [lon, lat];
}

function listOf(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw defect(`${what} of the map that is no list`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
