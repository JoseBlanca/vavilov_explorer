// The part of the data a 2D scatter shows, and how the pan and the zoom
// move it: plain arithmetic, tested in node (docs/design.md, section 2.2).

import type { AxisRange } from "./axes.ts";

/** The values at the edges of a 2D view: left and right of the x axis, bottom and top of the y axis. */
export interface View2d {
  /** The value of the x axis at the left edge. */
  readonly left: number;
  /** The value of the x axis at the right edge. */
  readonly right: number;
  /** The value of the y axis at the bottom edge. */
  readonly bottom: number;
  /** The value of the y axis at the top edge. */
  readonly top: number;
}

/** The share of each side of the view the points fill when framed, as on the maps. */
const FILL = 0.9;
/** How far a view can be zoomed out, against the framed view, as the maps. */
export const MIN_ZOOM = 0.5;
/** How far a view can be zoomed in, against the framed view. */
export const MAX_ZOOM = 1000;

/**
 * The values from `range.min` to `range.max` framed in {@link FILL} of a
 * side; a range of one value is given a side of a tenth of it, or of 1 at
 * 0, so that the points are shown with room around them.
 */
function framed(range: AxisRange): { readonly low: number; readonly high: number } {
  const span = range.max - range.min;
  const side = span > 0 ? span / FILL : range.min === 0 ? 1 : Math.abs(range.min) / 10;
  const middle = (range.min + range.max) / 2;
  return { low: middle - side / 2, high: middle + side / 2 };
}

/** The view that frames the values `x` and `y`, each in its middle {@link FILL}. */
export function homeView(x: AxisRange, y: AxisRange): View2d {
  const across = framed(x);
  const up = framed(y);
  return { left: across.low, right: across.high, bottom: up.low, top: up.high };
}

/** `view` moved by `dx` of its width to the right and `dy` of its height up. */
export function panView(view: View2d, dx: number, dy: number): View2d {
  const x = dx * (view.right - view.left);
  const y = dy * (view.top - view.bottom);
  return { left: view.left + x, right: view.right + x, bottom: view.bottom + y, top: view.top + y };
}

/** How many times nearer `view` is than `home`. */
export function zoomOf(view: View2d, home: View2d): number {
  return (home.right - home.left) / (view.right - view.left);
}

/**
 * `view` brought `factor` times nearer about the place `fx` of its width
 * from the left and `fy` of its height from the bottom, which stays where it
 * was; no further out than {@link MIN_ZOOM} nor in than {@link MAX_ZOOM}
 * against `home`.
 */
export function zoomView(
  view: View2d,
  factor: number,
  fx: number,
  fy: number,
  home: View2d,
): View2d {
  const now = zoomOf(view, home);
  const by = Math.min(Math.max(now * factor, MIN_ZOOM), MAX_ZOOM) / now;
  const width = (view.right - view.left) / by;
  const height = (view.top - view.bottom) / by;
  const x = view.left + fx * (view.right - view.left);
  const y = view.bottom + fy * (view.top - view.bottom);
  return {
    left: x - fx * width,
    right: x + (1 - fx) * width,
    bottom: y - fy * height,
    top: y + (1 - fy) * height,
  };
}
