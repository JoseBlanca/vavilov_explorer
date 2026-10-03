import { describe, expect, test } from "vitest";

import type { ColumnDescription, TableDescription } from "./description.ts";
import { isColumnId, isRevision } from "./ids.ts";
import type { ColumnId, Revision } from "./ids.ts";
import { axisColumns, startingAxes } from "./scatterAxes.ts";

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
  test("are the first three columns", () => {
    expect(startingAxes(axisColumns(TABLE))).toEqual([2, 4, 6]);
  });

  test("start the list again when it has fewer than three", () => {
    const two = axisColumns(table([column(2, "PC1", "number"), column(7, "PC2", "number")]));
    expect(startingAxes(two)).toEqual([2, 7, 2]);
    expect(startingAxes(two.slice(0, 1))).toEqual([2, 2, 2]);
  });

  test("are none with no column of numbers", () => {
    expect(startingAxes(axisColumns(table([column(1, "origin", "category")])))).toBe(null);
  });
});
