// A set of rows as the backend reads and writes one: one bit per row, row
// `i` in bit `i % 8` of byte `i / 8`, the bits beyond the last row zero
// (crates/vavilov-core/src/row_set.rs).

/** The rows from `from` to `to`, both included and in either order, of a table of `numRows`. */
export function rangeBits(numRows: number, from: number, to: number): Uint8Array {
  const bits = new Uint8Array(Math.ceil(numRows / 8));
  for (let row = Math.min(from, to); row <= Math.max(from, to); row += 1) {
    const at = Math.floor(row / 8);
    bits[at] = (bits[at] ?? 0) | (1 << (row % 8));
  }
  return bits;
}

/** Whether `row` is in the set. */
export function hasRow(bits: Uint8Array, row: number): boolean {
  return ((bits[Math.floor(row / 8)] ?? 0) & (1 << (row % 8))) !== 0;
}
