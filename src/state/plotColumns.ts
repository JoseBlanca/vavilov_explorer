// The columns each plot can show, and those the dialog of Plot > 3D
// scatter… starts from (docs/design.md, section 2.2).

import type { Role, TableDescription } from "./description.ts";
import type { ColumnId } from "./ids.ts";
import type { Axes } from "./widget.ts";

/** A column a plot can show, such as a number, a latitude or a longitude on an axis of a 3D scatter. */
export interface PlotColumn {
  /** Its id. */
  readonly id: ColumnId;
  /** Its name, as in the user's file. */
  readonly name: string;
}

/** The columns of the table a 3D scatter can put on an axis, in the order of the table. */
export function axisColumns(description: TableDescription): readonly PlotColumn[] {
  return description.columns
    .filter(
      (column) =>
        column.role === "number" || column.role === "latitude" || column.role === "longitude",
    )
    .map(({ id, name }) => ({ id, name }));
}

/**
 * The axes the dialog starts from: the first three columns of the table
 * whose role is a number, the list started again when it has fewer, so that
 * one column is on every axis. Latitudes and longitudes, which are rarely
 * plotted against other numbers, are started from only when the table has
 * no plain number (decided by the owner on 4 October 2026). `null` when
 * there is no column a 3D scatter can show. Starting from the columns
 * selected in the table comes when columns can be selected there.
 */
export function startingAxes(description: TableDescription): Axes | null {
  const numbers = columnsOfRole(description, "number");
  const columns = numbers.length > 0 ? numbers : axisColumns(description);
  const [first, second = first, third = first] = columns;
  if (first === undefined || second === undefined || third === undefined) {
    return null;
  }
  return [first.id, second.id, columns.length === 2 ? first.id : third.id];
}

/**
 * The columns of the table whose role is `role`, in the order of the table:
 * those a map offers for its latitude, its longitude or its countries.
 */
export function columnsOfRole(description: TableDescription, role: Role): readonly PlotColumn[] {
  return description.columns
    .filter((column) => column.role === role)
    .map(({ id, name }) => ({ id, name }));
}
