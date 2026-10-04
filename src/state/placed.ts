// The individuals a point view can place: those with a value it can draw on
// every axis (docs/prototype-lessons.md, "Per-view placement"). The others
// are left out of this view alone, and counted (docs/design.md, section 2.2).

import type { ColumnNumbers } from "./columnNumbers.ts";
import { defect } from "./defect.ts";
import { countRows, hasRow, rowsWhere } from "./rowSet.ts";

/** The rows a view places, one bit per row as in the selection, and how many. */
export interface Placed {
  /** One bit per row, row `i` in bit `i % 8` of byte `i / 8`, set for a row placed. */
  readonly rows: Uint8Array;
  /** The number of rows placed. */
  readonly count: number;
  /** The number of rows of the table. */
  readonly numRows: number;
}

/** The value of `row` on `axis`, whose length was checked. */
function valueOf(axis: ColumnNumbers, row: number): number {
  const value = axis.values[row];
  if (value === undefined) {
    throw defect(`no row ${String(row)} in column ${String(axis.column)}`);
  }
  return value;
}

/**
 * The rows of a table of `numRows` rows that have, on each of `axes`, a
 * value that is not missing and is finite.
 *
 * @throws A defect when an axis has another number of rows.
 */
export function placedRows(axes: readonly ColumnNumbers[], numRows: number): Placed {
  for (const axis of axes) {
    if (axis.values.length !== numRows) {
      throw defect(
        `column ${String(axis.column)} of ${String(axis.values.length)} rows in a table of ${String(numRows)}`,
      );
    }
  }
  const rows = rowsWhere(numRows, (row) =>
    axes.every((axis) => !hasRow(axis.missing, row) && Number.isFinite(valueOf(axis, row))),
  );
  return { rows, count: countRows(rows), numRows };
}

/**
 * The line of a point view's information bar that says how many
 * individuals it draws, with `countWords` writing a count in the user's
 * language and `lacking` what those it leaves out lack: "Drawing all 2,000
 * individuals.", or "Drawing 1,688 of 2,000 individuals: 312 have no value
 * on an axis."
 */
export function placedText(
  placed: Placed,
  countWords: (value: number) => string,
  lacking: string,
): string {
  const left = placed.numRows - placed.count;
  const individuals = placed.numRows === 1 ? "individual" : "individuals";
  if (left === 0) {
    return placed.numRows === 1
      ? "Drawing the one individual."
      : `Drawing all ${countWords(placed.numRows)} ${individuals}.`;
  }
  const have = left === 1 ? "has" : "have";
  return `Drawing ${countWords(placed.count)} of ${countWords(placed.numRows)} ${individuals}: ${countWords(left)} ${have} ${lacking}.`;
}
