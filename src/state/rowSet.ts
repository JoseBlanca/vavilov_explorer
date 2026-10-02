// A set of rows as the backend reads and writes one: one bit per row, row
// `i` in bit `i % 8` of byte `i / 8`, the bits beyond the last row zero
// (crates/vavilov-core/src/row_set.rs).

import { defect } from "./defect.ts";

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

/**
 * The rows of `bits` that are also in `within`, a set of the same table;
 * all of `bits` for `null`.
 *
 * @throws A defect when the two sets are not of the same length, and so not
 * of the same table.
 */
export function intersection(bits: Uint8Array, within: Uint8Array | null): Uint8Array {
  if (within === null) {
    return bits;
  }
  if (within.length !== bits.length) {
    throw defect(
      `the rows in common of a set of ${String(bits.length)} bytes and one of ${String(within.length)}`,
    );
  }
  return bits.map((byte, index) => {
    const other = within[index];
    if (other === undefined) {
      throw defect(`no byte ${String(index)} in a set of ${String(within.length)} bytes`);
    }
    return byte & other;
  });
}

/** The number of rows in the set. */
export function countRows(bits: Uint8Array): number {
  let count = 0;
  for (const byte of bits) {
    for (let bit = byte; bit !== 0; bit &= bit - 1) {
      count += 1;
    }
  }
  return count;
}
