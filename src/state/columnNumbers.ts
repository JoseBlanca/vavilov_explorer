// A numeric column as a window draws it, whole, the answer of fetch_column
// (crates/vavilov-core/src/numbers.rs; docs/design.md, section 4).

import type { ColumnId, Revision } from "./ids.ts";

/** The values of a numeric column, one per row of the table. */
export interface ColumnNumbers {
  /** The column. */
  readonly column: ColumnId;
  /** The revision at which it last changed: the values are those of a copy at that revision. */
  readonly revision: Revision;
  /**
   * The middle of the smallest and the largest value, which `values` are
   * the distances from, 0 with every row missing.
   */
  readonly centre: number;
  /**
   * The distance of each row's value from `centre`, as the GPU draws it, a
   * 32-bit float, so that values far from zero and close together keep
   * their differences: 0 in a missing row, and an infinity for a distance
   * past about 3.4 × 10^38, which cannot be drawn.
   */
  readonly values: Float32Array;
  /** Which rows are missing, one bit per row, row `i` in bit `i % 8` of byte `i / 8`. */
  readonly missing: Uint8Array;
}
