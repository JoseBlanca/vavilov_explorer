// A cell of the table being edited (docs/design.md, section 2.1): which
// cell, the text in its field, and whether "Apply to all selected rows" is
// ticked; and the rows the edit applies to. Pure: the table's controller
// keeps the edit as its own.

import type { Cell } from "./cellText.ts";
import type { ColumnId, Revision, RowIndex } from "./ids.ts";
import { rangeBits } from "./rowSet.ts";

/** A cell being edited. */
export interface CellEdit {
  /** The load of the table it was opened in. */
  readonly loadedAt: Revision;
  /** Its row. */
  readonly row: RowIndex;
  /** Its column, the first included. */
  readonly column: ColumnId;
  /** The text in its field. */
  readonly text: string;
  /**
   * Whether the checkbox "Apply to all selected rows" is offered: not in
   * the first column, whose IDs are edited one at a time.
   */
  readonly offersSelected: boolean;
  /** Whether it is ticked, off when the edit opens. */
  readonly toSelected: boolean;
}

/**
 * The edit of the cell `cell` of `row` in `column`, opened in the table
 * loaded at `loadedAt` whose first column is `namesColumn`: its field
 * starts with the text the cell shows, empty for a missing value.
 */
export function openedEdit(
  loadedAt: Revision,
  row: RowIndex,
  column: ColumnId,
  namesColumn: ColumnId,
  cell: Cell,
): CellEdit {
  return {
    loadedAt,
    row,
    column,
    text: cell.kind === "missing" ? "" : cell.text,
    offersSelected: column !== namesColumn,
    toSelected: false,
  };
}

/**
 * The rows `edit` sets, as a set of rows of a table of `numRows`: the
 * selection when "Apply to all selected rows" is ticked, its own row
 * otherwise.
 */
export function editedRows(edit: CellEdit, numRows: number, selection: Uint8Array): Uint8Array {
  return edit.toSelected && edit.offersSelected
    ? selection.slice()
    : rangeBits(numRows, edit.row, edit.row);
}
