// Which of the three layers of a 2D scatter a point is drawn in, so that
// the hover is over the marked points and the marked over the rest, as in
// the point views drawn with WebGL (docs/design.md, section 2.2).

import { MARK } from "../state/pointStyle.ts";

/** A layer of the points: 0 under the others, 1 marked, 2 the hover over all. */
export type PointLayer = 0 | 1 | 2;

/** The layer of the point of `row`, with `hover` the row under the pointer and `mark` its mark. */
export function pointLayer(row: number, hover: number | null, mark: number): PointLayer {
  return row === hover ? 2 : mark === MARK.none ? 0 : 1;
}
