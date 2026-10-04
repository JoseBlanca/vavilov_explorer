// The part of d3-scale 4.0.2 the histogram uses, a linear scale, which
// ships no types of its own. A declaration is a claim the compiler cannot
// check, so it holds only what the plot calls.

declare module "d3-scale" {
  /** A linear map from a domain of values to a range of pixels. */
  export interface ScaleLinear {
    /** The place of `value` in the range. */
    (value: number): number;
    /** Sets the domain, the values at the two ends. */
    domain(domain: readonly [number, number]): ScaleLinear;
    /** Sets the range, the pixels of the two ends. */
    range(range: readonly [number, number]): ScaleLinear;
    /** Widens the domain to round values, for about `count` ticks. */
    nice(count?: number): ScaleLinear;
    /** About `count` round values inside the domain, for the ticks of an axis. */
    ticks(count?: number): number[];
  }
  /** A linear scale from [0, 1] to [0, 1], to be set. */
  export function scaleLinear(): ScaleLinear;
}
