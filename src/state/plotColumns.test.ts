import { describe, expect, test } from "vitest";

import type { ColumnDescription, TableDescription } from "./description.ts";
import { isColumnId, isRevision } from "./ids.ts";
import type { ColumnId, Revision } from "./ids.ts";
import {
  axisColumns,
  columnsOfRole,
  startingAxes,
  startingAxes2d,
  unfitColumn,
  widgetFits,
} from "./plotColumns.ts";

function id(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}
function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
  return value;
}

const AT = revision(1);

function column(
  value: number,
  name: string,
  role: "number" | "latitude" | "longitude" | "text" | "category" | "country",
): ColumnDescription {
  const common = { id: id(value), name, revision: AT, roles: [role] };
  switch (role) {
    case "number":
    case "latitude":
    case "longitude":
      return { ...common, storage: "float", role };
    case "text":
      return { ...common, storage: "text", role };
    case "category":
    case "country":
      return { ...common, storage: "text", role, levels: [] };
  }
}

function table(columns: readonly ColumnDescription[]): TableDescription {
  return {
    loadedAt: AT,
    shapeAt: AT,
    numRows: 3,
    names: { id: id(0), header: "IndividualID" },
    columns,
  };
}

const TABLE = table([
  column(1, "origin", "category"),
  column(2, "PC1", "number"),
  column(3, "note", "text"),
  column(4, "lat", "latitude"),
  column(5, "country", "country"),
  column(6, "lon", "longitude"),
  column(7, "PC2", "number"),
]);

describe("axisColumns", () => {
  test("are the numbers, latitudes and longitudes, in the order of the table", () => {
    expect(axisColumns(TABLE)).toEqual([
      { id: 2, name: "PC1" },
      { id: 4, name: "lat" },
      { id: 6, name: "lon" },
      { id: 7, name: "PC2" },
    ]);
  });
});

describe("startingAxes", () => {
  test("are the first three numbers, leaving out the latitudes and longitudes", () => {
    const three = table([...TABLE.columns, column(8, "PC3", "number")]);
    expect(startingAxes(three)).toEqual([2, 7, 8]);
  });

  test("start the list of numbers again when it has fewer than three", () => {
    expect(startingAxes(TABLE)).toEqual([2, 7, 2]);
    expect(startingAxes(table([column(4, "lat", "latitude"), column(2, "PC1", "number")]))).toEqual(
      [2, 2, 2],
    );
  });

  test("are the latitudes and longitudes when the table has no plain number", () => {
    const places = table([
      column(1, "origin", "category"),
      column(4, "lat", "latitude"),
      column(6, "lon", "longitude"),
    ]);
    expect(startingAxes(places)).toEqual([4, 6, 4]);
  });

  test("are none with no column of numbers", () => {
    expect(startingAxes(table([column(1, "origin", "category")]))).toBe(null);
  });
});

describe("startingAxes2d", () => {
  test("are the first two numbers, leaving out the latitudes and longitudes", () => {
    expect(startingAxes2d(TABLE)).toEqual([2, 7]);
  });

  test("put the one number on both axes", () => {
    expect(
      startingAxes2d(table([column(4, "lat", "latitude"), column(2, "PC1", "number")])),
    ).toEqual([2, 2]);
  });

  test("are the latitudes and longitudes when the table has no plain number", () => {
    const places = table([
      column(1, "origin", "category"),
      column(4, "lat", "latitude"),
      column(6, "lon", "longitude"),
    ]);
    expect(startingAxes2d(places)).toEqual([4, 6]);
  });

  test("are none with no column of numbers", () => {
    expect(startingAxes2d(table([column(1, "origin", "category")]))).toBe(null);
  });
});

describe("columnsOfRole", () => {
  test("are the columns of one role, in the order of the table, as a map offers them", () => {
    const places = table([
      column(4, "lat", "latitude"),
      column(2, "PC1", "number"),
      column(8, "Latitude", "latitude"),
      column(6, "lon", "longitude"),
    ]);
    expect(columnsOfRole(places, "latitude")).toEqual([
      { id: 4, name: "lat" },
      { id: 8, name: "Latitude" },
    ]);
    expect(columnsOfRole(places, "longitude")).toEqual([{ id: 6, name: "lon" }]);
    expect(columnsOfRole(TABLE, "country")).toEqual([{ id: 5, name: "country" }]);
    expect(columnsOfRole(places, "country")).toEqual([]);
  });
});

describe("widgetFits", () => {
  // height a number, lat a latitude, lon a longitude, origin a country,
  // cluster a category.
  const places = table([
    column(1, "height", "number"),
    column(2, "lat", "latitude"),
    column(3, "lon", "longitude"),
    column(4, "origin", "country"),
    column(5, "cluster", "category"),
  ]);

  test("a histogram or a 3D scatter shows a number, a latitude or a longitude", () => {
    expect(widgetFits({ kind: "histogram", column: id(1) }, places)).toBe(true);
    expect(widgetFits({ kind: "histogram", column: id(2) }, places)).toBe(true);
    expect(widgetFits({ kind: "scatter3d", axes: [id(1), id(2), id(3)] }, places)).toBe(true);
    expect(widgetFits({ kind: "histogram", column: id(5) }, places)).toBe(false);
    expect(widgetFits({ kind: "scatter3d", axes: [id(1), id(5), id(3)] }, places)).toBe(false);
  });

  test("a 2D scatter shows a number, a latitude or a longitude on each axis", () => {
    expect(widgetFits({ kind: "scatter2d", axes: [id(1), id(2)] }, places)).toBe(true);
    expect(widgetFits({ kind: "scatter2d", axes: [id(3), id(3)] }, places)).toBe(true);
    expect(widgetFits({ kind: "scatter2d", axes: [id(1), id(4)] }, places)).toBe(false);
    expect(widgetFits({ kind: "scatter2d", axes: [id(5), id(1)] }, places)).toBe(false);
  });

  test("a map shows a latitude and a longitude, each in its place", () => {
    expect(widgetFits({ kind: "map", latitude: id(2), longitude: id(3) }, places)).toBe(true);
    expect(widgetFits({ kind: "map", latitude: id(3), longitude: id(2) }, places)).toBe(false);
    expect(widgetFits({ kind: "map", latitude: id(1), longitude: id(3) }, places)).toBe(false);
  });

  test("a map of countries shows a column of countries alone", () => {
    expect(widgetFits({ kind: "countryMap", country: id(4) }, places)).toBe(true);
    expect(widgetFits({ kind: "countryMap", country: id(5) }, places)).toBe(false);
  });

  test("a column the table does not have fits nothing", () => {
    expect(widgetFits({ kind: "histogram", column: id(9) }, places)).toBe(false);
  });
});

describe("unfitColumn", () => {
  const places = table([
    column(1, "height", "number"),
    column(2, "lat", "latitude"),
    column(3, "lon", "longitude"),
    column(5, "cluster", "category"),
  ]);

  test("names the first column a widget cannot show, and the role it needs", () => {
    expect(unfitColumn({ kind: "scatter3d", axes: [id(1), id(5), id(9)] }, places)).toEqual({
      column: id(5),
      role: "number",
    });
    expect(unfitColumn({ kind: "map", latitude: id(3), longitude: id(3) }, places)).toEqual({
      column: id(3),
      role: "latitude",
    });
    expect(unfitColumn({ kind: "map", latitude: id(2), longitude: id(1) }, places)).toEqual({
      column: id(1),
      role: "longitude",
    });
    expect(unfitColumn({ kind: "scatter2d", axes: [id(1), id(5)] }, places)).toEqual({
      column: id(5),
      role: "number",
    });
    expect(unfitColumn({ kind: "countryMap", country: id(5) }, places)).toEqual({
      column: id(5),
      role: "country",
    });
  });

  test("is null for a widget whose columns all fit", () => {
    expect(unfitColumn({ kind: "histogram", column: id(2) }, places)).toBeNull();
  });
});
