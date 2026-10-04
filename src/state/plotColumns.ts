// The columns each plot can show, and those the dialog of Plot > 3D
// scatter… starts from (docs/design.md, section 2.2).

import type { Role, TableDescription } from "./description.ts";
import type { ColumnId } from "./ids.ts";
import type { Axes, WidgetSpec } from "./widget.ts";

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
 * The columns of the table whose role is `role`, in the order of the table:
 * those a map offers for its latitude, its longitude or its countries.
 */
export function columnsOfRole(description: TableDescription, role: Role): readonly PlotColumn[] {
  return description.columns
    .filter((column) => column.role === role)
    .map(({ id, name }) => ({ id, name }));
}

/**
 * Whether the table has every column `spec` shows, each of a role it can
 * show: a number, a latitude or a longitude on a histogram or an axis of a
 * 3D scatter, a latitude and a longitude in their places on a map, and a
 * column of countries on a map of countries. A window closes a widget that
 * does not fit, as after a change of role (docs/design.md, section 2.2).
 */
export function widgetFits(spec: WidgetSpec, description: TableDescription): boolean {
  const roleOf = (column: ColumnId): Role | undefined =>
    description.columns.find((each) => each.id === column)?.role;
  const isNumber = (column: ColumnId): boolean => {
    const role = roleOf(column);
    return role !== undefined && NUMBER_ROLES.includes(role);
  };
  switch (spec.kind) {
    case "histogram":
      return isNumber(spec.column);
    case "scatter3d":
      return spec.axes.every(isNumber);
    case "map":
      return roleOf(spec.latitude) === "latitude" && roleOf(spec.longitude) === "longitude";
    case "countryMap":
      return roleOf(spec.country) === "country";
  }
}
