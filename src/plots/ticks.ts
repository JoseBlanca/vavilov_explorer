// The values the ticks of an axis are written with, rounded to the digits
// their step needs (issue #10). A tick is placed at a multiple of its step,
// which in binary is off in its last bits: d3 gave 1.4999999999999999e23
// for 1.5e23, and a rounding to a fixed 12 digits wrote 123456789.1235 and
// 123456789.1236 both as 123456789.124.

/** The most significant digits a 64-bit float holds. */
const MAX_DIGITS = 17;

/** The value of a tick at `value` of an axis whose ticks are `step` apart, with the digits the step needs. */
export function roundTick(value: number, step: number): number {
  if (value === 0) {
    return 0;
  }
  // The digits from the value's first to the step's, which d3 and the 3D
  // scatter give as 1, 2, 2.5 or 5 times a power of ten: one more for the 5
  // of a 2.5.
  const digits =
    Math.floor(Math.log10(Math.abs(value))) - Math.floor(Math.log10(Math.abs(step))) + 2;
  if (digits < 1) {
    // Nearer 0 than a tenth of the step: the error of the sum at 0.
    return 0;
  }
  // A rounding to one digit too many leaves its zero, which Number drops.
  return Number(value.toPrecision(Math.min(digits, MAX_DIGITS)));
}

/** The values of `ticks`, d3's for one axis, each rounded to the step between the first two. */
export function roundTicks(ticks: readonly number[]): number[] {
  const [first, second] = ticks;
  if (first === undefined || second === undefined) {
    return [...ticks];
  }
  const step = Math.abs(second - first);
  return ticks.map((value) => roundTick(value, step));
}
