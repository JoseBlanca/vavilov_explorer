// The columns a 3D scatter can put on its axes, and those the dialog of
// Plot > 3D scatter… starts from (docs/design.md, section 2.2).

import type { TableDescription } from "./description.ts";
import type { ColumnId } from "./ids.ts";
import type { Axes } from "./widget.ts";

/** A column a 3D scatter can put on an axis: a number, a latitude or a longitude. */
export interface AxisColumn {
  /** Its id. */
  readonly id: ColumnId;
  /** Its name, as in the user's file. */
  readonly name: string;
}

/** The columns of the table a 3D scatter can put on an axis, in the order of the table. */
export function axisColumns(description: TableDescription): readonly AxisColumn[] {
  return description.columns
    .filter(
      (column) =>
        column.role === "number" || column.role === "latitude" || column.role === "longitude",
    )
    .map(({ id, name }) => ({ id, name }));
}

/**
 * The axes the dialog starts from: the first three columns of `columns`, the
 * list started again when it has fewer, so that one column is on every axis;
 * `null` when there is none. Starting from the columns selected in the table
 * comes when columns can be selected there.
 */
export function startingAxes(columns: readonly AxisColumn[]): Axes | null {
  const [first, second = first, third = first] = columns;
  if (first === undefined || second === undefined || third === undefined) {
    return null;
  }
  return [first.id, second.id, columns.length === 2 ? first.id : third.id];
}
