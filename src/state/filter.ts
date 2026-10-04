// The filter of the find bar above the table, as the backend holds it, and
// the rows it shows (docs/design.md, section 2.1;
// crates/vavilov-core/src/filter.rs).

import { defect } from "./defect.ts";
import { isRowIndex } from "./ids.ts";
import { intersection, rangeBits } from "./rowSet.ts";
import type { ColumnId, LevelCode, Position, Revision, RowIndex } from "./ids.ts";

/** How a number of a column compares with the one typed: "<", "≤", "=", "≥" or ">". */
export type Comparison = "less" | "atMost" | "equal" | "atLeast" | "greater";

/**
 * What a cell must be to match, the operator of the find bar and its
 * value: "contains" or "is" a text, "is" a group chosen from the list of a
 * category or a column of countries, `null` before one is chosen, a
 * comparison with a number as typed, or "is missing". An empty text, and a
 * group not chosen, match every row.
 */
export type Condition =
  | { readonly kind: "contains"; readonly text: string }
  | { readonly kind: "is"; readonly text: string }
  | { readonly kind: "group"; readonly code: LevelCode | null }
  | { readonly kind: "compare"; readonly comparison: Comparison; readonly text: string }
  | { readonly kind: "missing" };

/** Whether the filter is showing the rows that match, or those that do not. */
export type Showing = "matching" | "notMatching";

/**
 * The most characters the text of a filter may have, `MAX_FILTER_TEXT` of
 * the core, which refuses a longer text as a defect; the find bar's field
 * takes no more.
 */
export const MAX_FILTER_TEXT = 1_000;

/** The filter of the find bar. With no text, number or group it shows every row. */
export interface Filter {
  /** The column searched, or `null` for any column, the first included. */
  readonly column: ColumnId | null;
  /** What a cell must be to match. */
  readonly condition: Condition;
  /** Whether it is showing the rows that match or the others. */
  readonly showing: Showing;
}

/** The rows the filter shows, as the filter part of a message gives them. */
export interface Shown {
  /** The revision at which the rows shown last changed. */
  readonly at: Revision;
  /** The number of rows shown. */
  readonly numShown: number;
  /**
   * One bit per row of the table, set for a row shown, as the selection's
   * bits are laid out; `null` when every row is shown, as the backend
   * sends while the filter has no text.
   */
  readonly bits: Uint8Array | null;
  /**
   * Whether the filter shows every row because its comparison's text is
   * no number written with the decimal mark of the window that set it.
   */
  readonly unreadableNumber: boolean;
}

/** Whether two filters are the same filter. */
export function sameFilter(one: Filter, other: Filter): boolean {
  return (
    one.column === other.column &&
    one.showing === other.showing &&
    sameCondition(one.condition, other.condition)
  );
}

/** Whether two conditions are the same. */
function sameCondition(one: Condition, other: Condition): boolean {
  switch (one.kind) {
    case "contains":
    case "is":
      return other.kind === one.kind && other.text === one.text;
    case "group":
      return other.kind === "group" && other.code === one.code;
    case "compare":
      return (
        other.kind === "compare" && other.comparison === one.comparison && other.text === one.text
      );
    case "missing":
      return other.kind === "missing";
  }
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
export function rowAt(rows: Uint32Array | null, position: Position): RowIndex {
  const row = rows === null ? position : rows[position];
  if (row === undefined || !isRowIndex(row)) {
    throw defect(`no row shown at position ${String(position)}`);
  }
  return row;
}

/**
 * The rows from `from` to `to`, both included and in either order, of a
 * table of `numRows`, that the filter shows: those a shift-click selects.
 *
 * @throws A defect for `null`, a copy of an open table with no rows shown.
 */
export function shownBetween(
  numRows: number,
  from: RowIndex,
  to: RowIndex,
  shown: Shown | null,
): Uint8Array {
  if (shown === null) {
    throw defect(`a range of rows of a table of ${String(numRows)} rows with no rows shown`);
  }
  return intersection(rangeBits(numRows, from, to), shown.bits);
}

/**
 * Every row of a table of `numRows` that the filter shows, as a selection:
 * those "Select shown rows" selects, all of them while the filter has no
 * text.
 *
 * @throws A defect for `null`, a copy of an open table with no rows shown.
 */
export function everyShown(numRows: number, shown: Shown | null): Uint8Array {
  if (shown === null) {
    throw defect(`the rows shown of a table of ${String(numRows)} rows with no rows shown`);
  }
  const every = numRows === 0 ? new Uint8Array(0) : rangeBits(numRows, 0, numRows - 1);
  return intersection(every, shown.bits);
}
