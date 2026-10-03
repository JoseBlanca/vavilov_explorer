// A cell of the table being edited (docs/design.md, section 2.1): which
// cell, the text in its field, and whether "Apply to all selected rows" is
// ticked; whether the checkbox is offered, the values the field suggests,
// and the rows the edit applies to. Pure: the table's controller keeps the
// edit as its own.

import type { Cell } from "./cellText.ts";
import type { ColumnId, Revision, RowIndex } from "./ids.ts";
import { countRows, hasRow, rangeBits } from "./rowSet.ts";

/** A cell being edited. */
export interface CellEdit {
  /** The load of the table it was opened in. */
  readonly loadedAt: Revision;
  /** Its row. */
  readonly row: RowIndex;
  /** Its column, the first included. */
  readonly column: ColumnId;
  /** The first column of its table, whose IDs are edited one at a time. */
  readonly namesColumn: ColumnId;
  /** The text in its field. */
  readonly text: string;
  /** Whether "Apply to all selected rows" is ticked, off when the edit opens. */
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
    namesColumn,
    text: cell.kind === "missing" ? "" : cell.text,
    toSelected: false,
  };
}

/**
 * Whether the checkbox "Apply to all selected rows" is offered for `edit`:
 * when its row is one of a selection of several, and its column is not the
 * first, whose IDs are edited one at a time.
 */
export function offersSelected(edit: CellEdit, selection: Uint8Array): boolean {
  return (
    edit.column !== edit.namesColumn && hasRow(selection, edit.row) && countRows(selection) > 1
  );
}

/**
 * The rows `edit` sets, as a set of rows of a table of `numRows`: the
 * selection when "Apply to all selected rows" is offered and ticked, its
 * own row otherwise.
 */
export function editedRows(edit: CellEdit, numRows: number, selection: Uint8Array): Uint8Array {
  return edit.toSelected && offersSelected(edit, selection)
    ? selection.slice()
    : rangeBits(numRows, edit.row, edit.row);
}

/**
 * The values of a category the field suggests while `text` is typed:
 * none once the one value whose text holds what was typed, case ignored,
 * is the text itself, so that the list of suggestions closes; all of them
 * otherwise, and the engine shows those that fit.
 */
export function suggestedValues(values: readonly string[], text: string): readonly string[] {
  const lower = text.toLowerCase();
  const fitting = values.filter((value) => value.toLowerCase().includes(lower));
  return fitting.length === 1 && fitting[0] === text ? [] : values;
}
