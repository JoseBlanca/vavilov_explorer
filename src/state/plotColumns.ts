// The columns each plot can show, and those the dialog of Plot > 3D
// scatter… starts from (docs/design.md, section 2.2).

import type { Role, TableDescription } from "./description.ts";
import type { ColumnId } from "./ids.ts";
import type { Axes, Axes2, WidgetSpec } from "./widget.ts";

/** A column a plot can show, such as a number, a latitude or a longitude on an axis of a 3D scatter. */
export interface PlotColumn {
  /** Its id. */
  readonly id: ColumnId;
  /** Its name, as in the user's file. */
  readonly name: string;
}

/** The roles of the columns of numbers, which a histogram or an axis of a 3D scatter shows. */
const NUMBER_ROLES: readonly Role[] = ["number", "latitude", "longitude"];

/** The columns of the table a 3D scatter can put on an axis, in the order of the table. */
export function axisColumns(description: TableDescription): readonly PlotColumn[] {
  return description.columns
    .filter((column) => NUMBER_ROLES.includes(column.role))
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
 * The axes the dialog of a 2D scatter starts from, x then y: the first two
 * columns of the table whose role is a number, or the one on both axes,
 * and the latitudes and longitudes only when the table has no plain
 * number, as for the 3D scatter (decided by the owner on 4 October 2026).
 * `null` when there is no column a 2D scatter can show.
 */
export function startingAxes2d(description: TableDescription): Axes2 | null {
  const numbers = columnsOfRole(description, "number");
  const [first, second = first] = numbers.length > 0 ? numbers : axisColumns(description);
  if (first === undefined || second === undefined) {
    return null;
  }
  return [first.id, second.id];
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

/** A column a widget cannot show, and the role it needs there: "number" for a number, a latitude or a longitude. */
export interface UnfitColumn {
  /** The column. */
  readonly column: ColumnId;
  /** The role the widget needs of it. */
  readonly role: Role;
}

/**
 * The first column of `spec` the table cannot show as the widget needs it,
 * or `null` when every column fits: a histogram and the axes of a 3D or
 * a 2D scatter need a number, a latitude or a longitude, a map a latitude and a
 * longitude in their places, and a map of countries a column of countries.
 * A window closes a widget that does not fit, as after a change of role,
 * and the main window does not ask for one (docs/design.md, section 2.2).
 */
export function unfitColumn(spec: WidgetSpec, description: TableDescription): UnfitColumn | null {
  const roleOf = (column: ColumnId): Role | undefined =>
    description.columns.find((each) => each.id === column)?.role;
  return (
    needsOf(spec).find(({ column, role }) => {
      const has = roleOf(column);
      return has === undefined || (role === "number" ? !NUMBER_ROLES.includes(has) : has !== role);
    }) ?? null
  );
}

/** The columns of `spec`, each with the role it needs there. */
function needsOf(spec: WidgetSpec): readonly UnfitColumn[] {
  switch (spec.kind) {
    case "histogram":
      return [{ column: spec.column, role: "number" }];
    case "scatter3d":
    case "scatter2d":
      return spec.axes.map((column) => ({ column, role: "number" }));
    case "map":
      return [
        { column: spec.latitude, role: "latitude" },
        { column: spec.longitude, role: "longitude" },
      ];
    case "countryMap":
      return [{ column: spec.country, role: "country" }];
  }
}

/** Whether the table has every column `spec` shows, each of a role it can show ({@link unfitColumn}). */
export function widgetFits(spec: WidgetSpec, description: TableDescription): boolean {
  return unfitColumn(spec, description) === null;
}
