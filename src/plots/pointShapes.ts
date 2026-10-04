// The shapes of the points as SVG paths, for a plot drawn in SVG, the
// same five the point views' shader draws (src/state/pointStyle.ts,
// SHAPES), so that a group has one shape in every plot.

import { defect } from "../state/defect.ts";
import { SHAPES } from "../state/pointStyle.ts";

/** The half side of a square, against its size: its area is about the circle's. */
const SQUARE_HALF = 0.4375;

/** A coordinate of a path, rounded to a hundredth of a pixel. */
function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The corners of a plus of `size` across, whose arms are a third of it wide. */
function plusCorners(size: number): readonly (readonly [number, number])[] {
  const h = size / 2;
  const t = size / 6;
  return [
    [-t, -h],
    [t, -h],
    [t, -t],
    [h, -t],
    [h, t],
    [t, t],
    [t, h],
    [-t, h],
    [-t, t],
    [-h, t],
    [-h, -t],
    [-t, -t],
  ];
}

/**
 * The SVG path of a point of the shape `code`, a value of
 * {@link SHAPES}' order, of `size` CSS pixels across, centred on 0, 0.
 *
 * @throws A defect for a code past the shapes.
 */
export function shapePath(code: number, size: number): string {
  const h = size / 2;
  const c = coordinate;
  const shape = SHAPES[code];
  if (shape === undefined) {
    throw defect(`a point of the shape ${String(code)}, past the ${String(SHAPES.length)}`);
  }
  switch (shape) {
    case "circle":
      return `M${c(h)},0A${c(h)},${c(h)} 0 1 1 ${c(-h)},0A${c(h)},${c(h)} 0 1 1 ${c(h)},0Z`;
    case "square": {
      const s = size * SQUARE_HALF;
      return `M${c(-s)},${c(-s)}H${c(s)}V${c(s)}H${c(-s)}Z`;
    }
    case "diamond":
      return `M0,${c(-h)}L${c(h)},0L0,${c(h)}L${c(-h)},0Z`;
    case "cross": {
      const t = size / 6;
      return (
        `M${c(-t)},${c(-h)}H${c(t)}V${c(-t)}H${c(h)}V${c(t)}H${c(t)}` +
        `V${c(h)}H${c(-t)}V${c(t)}H${c(-h)}V${c(-t)}H${c(-t)}Z`
      );
    }
    case "x": {
      const turn = Math.SQRT1_2;
      const corners = plusCorners(size).map(
        ([x, y]) => `${c((x - y) * turn)},${c((x + y) * turn)}`,
      );
      return `M${corners.join("L")}Z`;
    }
  }
}
