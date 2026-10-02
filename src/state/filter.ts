// The filter of the find bar above the table, as the backend holds it
// (docs/design.md, section 2.1; crates/vavilov-core/src/filter.rs).

import { defect } from "./defect.ts";
import { isRowIndex } from "./ids.ts";
import type { ColumnId, Revision, RowIndex } from "./ids.ts";

/** How the text must match a cell: as part of it, or as its whole text. */
export type CellMatch = "part" | "whole";

/** Which rows the filter shows: those that match, or those that do not. */
export type ShownRows = "matching" | "notMatching";

/** The filter of the find bar. With no text it shows every row. */
export interface Filter {
  /** The text searched for; empty for none. */
  readonly text: string;
  /** The column searched, or `null` for any column, the first included. */
  readonly column: ColumnId | null;
  /** How the text must match a cell. */
  readonly cell: CellMatch;
  /** Which rows are shown. */
  readonly shown: ShownRows;
}

/** The filter and the rows it shows, as the filter part of a message gives them. */
export interface Shown {
  /** The filter. */
  readonly filter: Filter;
  /** The revision at which the rows shown last changed. */
  readonly at: Revision;
  /** The number of rows shown. */
  readonly numShown: number;
  /**
   * One bit per row of the table, set for a row shown, as the selection's
   * bits are laid out; `null` when every row is shown.
   */
  readonly bits: Uint8Array | null;
}

/**
 * The row of the table at each position among the rows shown, from the
 * bits of `shown`; `null` when every row is shown, so that the position is
 * the row.
 *
 * @throws A defect when the bits do not hold `numShown` rows.
 */
export function shownRowsOf(shown: Shown): Uint32Array | null {
  if (shown.bits === null) {
    return null;
  }
  const rows = new Uint32Array(shown.numShown);
  let position = 0;
  shown.bits.forEach((byte, index) => {
    for (let bit = 0; bit < 8; bit += 1) {
      if ((byte & (1 << bit)) !== 0) {
        if (position >= rows.length) {
          throw defect(`more rows shown than the ${String(shown.numShown)} of the filter`);
        }
        rows[position] = index * 8 + bit;
        position += 1;
      }
    }
  });
  if (position !== rows.length) {
    throw defect(`${String(position)} rows shown, not the ${String(shown.numShown)} of the filter`);
  }
  return rows;
}

/**
 * The row at `position` among those shown, by `rows` of {@link shownRowsOf}.
 *
 * @throws A defect for a position past the rows shown.
 */
export function rowAt(rows: Uint32Array | null, position: number): RowIndex {
  const row = rows === null ? position : rows[position];
  if (row === undefined || !isRowIndex(row)) {
    throw defect(`no row shown at position ${String(position)}`);
  }
  return row;
}
