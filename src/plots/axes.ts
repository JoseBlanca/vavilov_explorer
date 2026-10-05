// The axes of a 3D scatter as numbers: how each column's values map to the
// scene, and the round values its ticks are drawn at
// (docs/prototype-lessons.md; the prototype's src/scatter/axes.ts).

import { defect } from "../state/defect.ts";
import { at } from "../state/at.ts";
import { hasRow } from "../state/rowSet.ts";
import { roundTick } from "./ticks.ts";

/** The smallest and the largest value drawn on an axis. */
export interface AxisRange {
  /** The smallest value. */
  readonly min: number;
  /** The largest value. */
  readonly max: number;
}

/** How one axis maps onto the scene: `scene = (value - centre) * scale`. */
export interface AxisMap {
  /** The value at the centre of the scene. */
  readonly centre: number;
  /** The length in the scene of one unit of the values. */
  readonly scale: number;
  /** Half the length of the axis in the scene. */
  readonly half: number;
}

/**
 * Past this ratio between the longest and the shortest axis, every axis is
 * stretched to the same length; below it their true proportions are kept,
 * so that a PCA shows how much more spread PC1 has than PC3. Plotly's
 * `aspectmode: "auto"` has the same rule, which the prototype took.
 */
const MAX_ASPECT_RATIO = 4;

/**
 * The maps of three axes: the longest spans −1 to 1. An axis of a single
 * value still gets a length, so that the box never collapses.
 *
 * @throws A defect for a range that is not finite or whose maximum is below
 * its minimum.
 */
export function sceneMaps(ranges: readonly AxisRange[]): AxisMap[] {
  const spans = ranges.map((range) => {
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max < range.min) {
      throw defect(`an axis from ${String(range.min)} to ${String(range.max)}`);
    }
    const span = range.max - range.min;
    return span > 0 ? span : Math.max(Math.abs(range.min), 1);
  });
  const longest = Math.max(...spans);
  const cube = longest / Math.min(...spans) > MAX_ASPECT_RATIO;
  return ranges.map((range, index) => {
    const span = at(spans, index);
    const scale = 2 / (cube ? span : longest);
    return { centre: (range.min + range.max) / 2, scale, half: (span * scale) / 2 };
  });
}

/** The largest relative error of a value rounded to a 32-bit float, 2^-23. */
const F32_RELATIVE_PRECISION = 2 ** -23;

/** The round steps a tick can take, times a power of ten. */
const STEPS = [1, 2, 2.5, 5, 10];

/**
 * Round values from `min` to `max` for the ticks of an axis, about `target`
 * of them; the one value for an axis of one value.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) {
    return [min];
  }
  const raw = (max - min) / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = STEPS.map((multiple) => multiple * magnitude).reduce((best, next) =>
    Math.abs(Math.log(next / raw)) < Math.abs(Math.log(best / raw)) ? next : best,
  );
  // A value at an end that is round in the column comes as a 32-bit
  // distance from the middle of the range, up to one part in 2^23 of the
  // range off its round value, and is still a tick.
  const slack = (max - min) * F32_RELATIVE_PRECISION + step * 1e-9;
  const ticks: number[] = [];
  // Rounded so that 3 × 0.1 is 0.3, not 0.30000000000000004, before it is
  // compared with the end: a tick at the end is still one when its multiple
  // of the step lands past it in the last bits.
  for (
    let at = Math.ceil((min - slack) / step), tick = roundTick(at * step, step);
    tick <= max + slack;
    at += 1, tick = roundTick(at * step, step)
  ) {
    ticks.push(tick);
  }
  return ticks;
}

/** The range of the values of the rows placed, or `null` when none is. */
export function rangeOf(values: Float32Array, placed: Uint8Array): AxisRange | null {
  let min = Infinity;
  let max = -Infinity;
  values.forEach((value, row) => {
    if (hasRow(placed, row)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  });
  return min <= max ? { min, max } : null;
}
