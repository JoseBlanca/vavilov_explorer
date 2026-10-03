// The cell of the table the keyboard is on (docs/design.md, section 2.1):
// its row and its column, and where each key moves it among the rows the
// filter shows. Pure: the table's controller keeps the cell as its own.

import { defect } from "./defect.ts";
import { rowAt } from "./filter.ts";
import { isPosition } from "./ids.ts";
import type { ColumnId, Position, RowIndex } from "./ids.ts";

/** The cell the keyboard is on. */
export interface ActiveCell {
  /** Its row in the table. */
  readonly row: RowIndex;
  /** Its column, the first included. */
  readonly column: ColumnId;
}

/** A key that moves the cell the keyboard is on. */
export type Move = "up" | "down" | "left" | "right" | "home" | "end" | "pageUp" | "pageDown";

/** The rows the filter shows, as the table holds them. */
export interface ShownRows {
  /** How many. */
  readonly numShown: number;
  /** The row at each position, in the order of the rows; `null` when every row is shown. */
  readonly rows: Uint32Array | null;
}

/** The position of `row` among the rows shown, or `null` when it is not shown. */
export function positionOf(row: RowIndex, shown: ShownRows): Position | null {
  let found: number | null;
  if (shown.rows === null) {
    found = row < shown.numShown ? row : null;
  } else {
    // The rows shown are in the order of the rows: a bisection.
    let low = 0;
    let high = shown.rows.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const at = shown.rows[middle];
      if (at === undefined) {
        throw defect(`no row shown at position ${String(middle)}`);
      }
      if (at < row) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    found = shown.rows[low] === row ? low : null;
  }
  return found !== null && isPosition(found) ? found : null;
}

/**
 * The cell `move` takes `active` to, among `columns` and the rows `shown`,
 * a page being `pageRows` rows; the first shown row's first cell when
 * `active` is `null`, or its row is no longer shown or its column no
 * longer in the table; `null` when no row is shown. A move stops at the
 * edges of the table.
 */
export function moved(
  active: ActiveCell | null,
  move: Move,
  columns: readonly ColumnId[],
  shown: ShownRows,
  pageRows: number,
): ActiveCell | null {
  const firstColumn = columns[0];
  if (shown.numShown === 0 || firstColumn === undefined) {
    return null;
  }
  const at = (position: number, column: ColumnId): ActiveCell => {
    const clamped = Math.min(Math.max(position, 0), shown.numShown - 1);
    if (!isPosition(clamped)) {
      throw defect(`a position ${String(clamped)} of the active cell`);
    }
    return { row: rowAt(shown.rows, clamped), column };
  };
  const position = active === null ? null : positionOf(active.row, shown);
  const index = active === null ? -1 : columns.indexOf(active.column);
  if (active === null || position === null || index === -1) {
    return at(0, firstColumn);
  }
  const columnAt = (wanted: number): ColumnId => {
    const column = columns[Math.min(Math.max(wanted, 0), columns.length - 1)];
    if (column === undefined) {
      throw defect(`no column ${String(wanted)} of ${String(columns.length)}`);
    }
    return column;
  };
  switch (move) {
    case "up":
      return at(position - 1, active.column);
    case "down":
      return at(position + 1, active.column);
    case "pageUp":
      return at(position - pageRows, active.column);
    case "pageDown":
      return at(position + pageRows, active.column);
    case "left":
      return at(position, columnAt(index - 1));
    case "right":
      return at(position, columnAt(index + 1));
    case "home":
      return at(position, columnAt(0));
    case "end":
      return at(position, columnAt(columns.length - 1));
  }
}
