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
/**
 * How far a view can be zoomed in, against the framed view: chosen by the
 * assistant on 4 October 2026, for the points of a column to spread apart
 * a thousand times; the maps' 5,000 is for the whole world down to a town.
 */
export const MAX_ZOOM = 1000;
/**
 * The least side a framed view is given, in the units of its column: d3
 * cannot count the ticks of a side below about 1e-305, as a column of
 * values near 1e-310 would have, and a view {@link MAX_ZOOM} times nearer
 * still has a side of 1e-303.
 */
export const MIN_SIDE = 1e-300;
/** The pixels of a line of the wheel, in a browser that scrolls by lines, as on the maps. */
const WHEEL_LINE_PX = 16;
/** The pixels of a page of the wheel, as on the maps. */
const WHEEL_PAGE_PX = 100;
/** How many times a pinch of a trackpad counts its pixels, as on the maps. */
const PINCH_SCALE = 10;
/** How many times nearer 100 pixels of the wheel up bring the view, as on the maps. */
const WHEEL_STEP = 1 / 0.95;

/**
 * The values from `range.min` to `range.max` framed in {@link FILL} of a
 * side; a range of one value is given a side of a tenth of it, or of 1 at
 * 0, so that the points are shown with room around them.
 */
function framed(range: AxisRange): { readonly low: number; readonly high: number } {
  const span = range.max - range.min;
  const given = span > 0 ? span / FILL : range.min === 0 ? 1 : Math.abs(range.min) / 10;
  const side = Math.max(given, MIN_SIDE);
  // Halved before the sum, which overflows for two values above 9e307.
  const middle = range.min / 2 + range.max / 2;
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
 * against `home`. A view already past a limit, as when new values moved
 * `home` under it, zooms only the way asked, or stays.
 */
export function zoomView(
  view: View2d,
  factor: number,
  fx: number,
  fy: number,
  home: View2d,
): View2d {
  const now = zoomOf(view, home);
  const wanted = now * factor;
  const bounded =
    factor >= 1
      ? Math.min(wanted, Math.max(MAX_ZOOM, now))
      : Math.max(wanted, Math.min(MIN_ZOOM, now));
  const by = bounded / now;
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

/**
 * The pixels a wheel's `delta` stands for, by its `deltaMode`, as the maps
 * count them (three's OrbitControls): 0 pixels; 1 lines, of
 * {@link WHEEL_LINE_PX}; 2 pages, of {@link WHEEL_PAGE_PX}; and ten times
 * as many for a `pinch` of a trackpad, which a web view sends as a wheel
 * with Ctrl.
 */
export function wheelPixels(delta: number, deltaMode: number, pinch: boolean): number {
  const unit = deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  return delta * unit * (pinch ? PINCH_SCALE : 1);
}

/** How many times nearer the wheel's `pixels` bring the view, as on the maps. */
export function wheelZoom(pixels: number): number {
  return WHEEL_STEP ** (-pixels / 100);
}
