// Where the points of a point view are on the screen, which point is under
// the pointer, and which are inside a lasso: plain arithmetic over typed
// arrays, so that it is tested in node (frontend.md, "The point views").

import { defect } from "../state/defect.ts";
import { at } from "../state/at.ts";
import { rowsWhere } from "../state/rowSet.ts";

/** Each point's place on the canvas, in CSS pixels from its top left corner. */
export interface ScreenPoints {
  /** `x0, y0, x1, y1, …`; NaN for a point not drawn or behind the camera. */
  readonly xy: Float32Array;
  /** The depth of each point, smaller nearer the camera; Infinity for one not drawn. */
  readonly depth: Float32Array;
}

/**
 * Projects `positions`, three per point in the scene, with `matrix`, the
 * camera's projection times its view, sixteen numbers in the column order
 * Three.js keeps them, onto a canvas of `width` by `height` CSS pixels. A
 * point whose size is 0 is not drawn, and has no place.
 */
export function projectPoints(
  matrix: ArrayLike<number>,
  positions: Float32Array,
  sizes: Float32Array,
  width: number,
  height: number,
): ScreenPoints {
  const count = sizes.length;
  if (positions.length !== 3 * count || matrix.length !== 16) {
    throw defect(
      `${String(positions.length)} coordinates for ${String(count)} points, and a matrix of ${String(matrix.length)}`,
    );
  }
  const xy = new Float32Array(2 * count);
  const depth = new Float32Array(count);
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15] = [
    at(matrix, 0),
    at(matrix, 1),
    at(matrix, 2),
    at(matrix, 3),
    at(matrix, 4),
    at(matrix, 5),
    at(matrix, 6),
    at(matrix, 7),
    at(matrix, 8),
    at(matrix, 9),
    at(matrix, 10),
    at(matrix, 11),
    at(matrix, 12),
    at(matrix, 13),
    at(matrix, 14),
    at(matrix, 15),
  ];
  for (let point = 0; point < count; point += 1) {
    const x = at(positions, 3 * point);
    const y = at(positions, 3 * point + 1);
    const z = at(positions, 3 * point + 2);
    const w = m3 * x + m7 * y + m11 * z + m15;
    if (at(sizes, point) <= 0 || w <= 0) {
      xy[2 * point] = Number.NaN;
      xy[2 * point + 1] = Number.NaN;
      depth[point] = Infinity;
      continue;
    }
    const clipX = (m0 * x + m4 * y + m8 * z + m12) / w;
    const clipY = (m1 * x + m5 * y + m9 * z + m13) / w;
    xy[2 * point] = ((clipX + 1) / 2) * width;
    xy[2 * point + 1] = ((1 - clipY) / 2) * height;
    depth[point] = (m2 * x + m6 * y + m10 * z + m14) / w;
  }
  return { xy, depth };
}

/**
 * The point nearest the camera whose disc, of its size plus `slop` CSS
 * pixels around it, holds the place `x`, `y` on the canvas; `null` for none.
 */
export function pickPoint(
  screen: ScreenPoints,
  sizes: Float32Array,
  x: number,
  y: number,
  slop: number,
): number | null {
  let best: number | null = null;
  let bestDepth = Infinity;
  screen.depth.forEach((depth, point) => {
    const radius = at(sizes, point) / 2 + slop;
    const place = placeOnScreen(screen, point);
    const dx = place.x - x;
    const dy = place.y - y;
    if (dx * dx + dy * dy <= radius * radius && depth < bestDepth) {
      best = point;
      bestDepth = depth;
    }
  });
  return best;
}

/**
 * Whether `x`, `y` is inside `polygon`, `x0, y0, x1, y1, …`, by the even and
 * odd rule, so that a lasso that crosses itself gives a result a user can
 * foresee.
 */
export function insidePolygon(polygon: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const length = polygon.length - (polygon.length % 2);
  for (let i = 0, j = length - 2; i < length; j = i, i += 2) {
    const xi = at(polygon, i);
    const yi = at(polygon, i + 1);
    const xj = at(polygon, j);
    const yj = at(polygon, j + 1);
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** The place of `point` on the canvas, NaN when it is not drawn. */
export function placeOnScreen(screen: ScreenPoints, point: number): { x: number; y: number } {
  const x = screen.xy[2 * point];
  const y = screen.xy[2 * point + 1];
  if (x === undefined || y === undefined) {
    throw defect(`no point ${String(point)} among ${String(screen.depth.length)} on the screen`);
  }
  return { x, y };
}

/**
 * The points drawn whose place is inside `polygon`, one bit per point as
 * a selection has it, row `i` in bit `i % 8` of byte `i / 8`.
 */
export function pointsInPolygon(screen: ScreenPoints, polygon: readonly number[]): Uint8Array {
  return rowsWhere(screen.depth.length, (point) => {
    const { x, y } = placeOnScreen(screen, point);
    return !Number.isNaN(x) && insidePolygon(polygon, x, y);
  });
}
