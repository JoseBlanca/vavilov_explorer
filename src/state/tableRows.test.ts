import { describe, expect, test } from "vitest";

import type { TableDescription } from "./description.ts";
import { isColumnId, isRevision, isRowIndex } from "./ids.ts";
import type { ColumnId, Revision, RowIndex } from "./ids.ts";
import type { RowPage } from "./rowPage.ts";
import { rangeBits } from "./rowSet.ts";
import { fetchedColumns, tableColumns, tableRow } from "./tableRows.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}
function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error("not a row");
  return value;
}
function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
  return value;
}

/**
 * Four plants: 1 height, a number; 2 origin (Spain, Peru), a category;
 * 3 seeds, a number; 4 fertile, a category of yes or no; 5 note, text;
 * 6 dose (0.5, 2), a category of decimal numbers; 7 origin code (ESP,
 * PER), a category of countries; and 8 lat, a latitude.
 */
const PLANTS: TableDescription = {
  loadedAt: revision(1),
  shapeAt: revision(1),
  numRows: 4,
  names: { id: column(0), header: "IndividualID" },
  columns: [
    {
      id: column(1),
      name: "height",
      revision: revision(1),
      storage: "float",
      role: "number",
      roles: ["number", "latitude", "longitude", "category"],
    },
    {
      id: column(2),
      name: "origin",
      revision: revision(1),
      storage: "text",
      role: "category",
      roles: ["category", "country", "text"],
      levels: [
        { value: "Spain", colour: "#e69f00" },
        { value: "Peru", colour: "#56b4e9" },
      ],
    },
    {
      id: column(3),
      name: "seeds",
      revision: revision(1),
      storage: "integer",
      role: "number",
      roles: ["number", "category"],
    },
    {
      id: column(4),
      name: "fertile",
      revision: revision(1),
      storage: "boolean",
      role: "category",
      roles: ["category"],
      levels: [
        { value: false, colour: "#e69f00" },
        { value: true, colour: "#56b4e9" },
      ],
    },
    {
      id: column(5),
      name: "note",
      revision: revision(1),
      storage: "text",
      role: "text",
      roles: ["category", "text"],
    },
    {
      id: column(6),
      name: "dose",
      revision: revision(1),
      storage: "float",
      role: "category",
      roles: ["number", "category"],
      levels: [
        { value: 0.5, colour: "#e69f00" },
        { value: 2, colour: "#56b4e9" },
      ],
    },
    {
      id: column(7),
      name: "origin code",
      revision: revision(1),
      storage: "text",
      role: "country",
      roles: ["category", "country", "text"],
      levels: [
        { value: "ESP", colour: "#e69f00" },
        { value: "PER", colour: "#56b4e9" },
      ],
    },
    {
      id: column(8),
      name: "lat",
      revision: revision(1),
      storage: "float",
      role: "latitude",
      roles: ["number", "latitude", "longitude", "category"],
    },
  ],
};

/** Rows 2 and 3, as fetch_rows gives them, the columns in another order. */
const PAGE: RowPage = {
  revision: revision(1),
  loadedAt: revision(1),
  first: row(2),
  count: 2,
  names: ["p3", "p4"],
  columns: [
    { id: column(5), revision: revision(1), type: "text", values: ["tall", null] },
    { id: column(1), revision: revision(1), type: "float", values: [2.5, null] },
    { id: column(3), revision: revision(1), type: "integer", values: [null, -7n] },
    { id: column(8), revision: revision(1), type: "float", values: [40.5, -12] },
  ],
};

/**
 * origin: Spain, Peru, missing, Peru; fertile: FALSE, TRUE, TRUE, missing;
 * dose: 0.5, 2, 2, 0.5; origin code: PER, ESP, missing, ESP.
 */
const CODES = new Map<number, Uint16Array>([
  [2, new Uint16Array([0, 1, 0xffff, 1])],
  [4, new Uint16Array([0, 1, 1, 0xffff])],
  [6, new Uint16Array([0, 1, 1, 0])],
  [7, new Uint16Array([1, 0, 0xffff, 0])],
]);
const codesOf = (id: ColumnId): Uint16Array | null => CODES.get(id) ?? null;

describe("the columns of the table", () => {
  test("are the names, then every column in the order of the table, with its roles", () => {
    expect(
      tableColumns(PLANTS).map((c) => [
        c.id,
        c.name,
        c.kind,
        c.alignEnd,
        c.choices.map((choice) => choice.label),
      ]),
    ).toEqual([
      [0, "IndividualID", "names", false, []],
      [1, "height", "number", true, ["Number", "Latitude", "Longitude", "Category"]],
      [2, "origin", "category", false, ["Category", "Country", "Text"]],
      [3, "seeds", "number", true, ["Number", "Category"]],
      [4, "fertile", "category", false, ["Category"]],
      [5, "note", "text", false, ["Category", "Text"]],
      [6, "dose", "category", true, ["Number", "Category"]],
      [7, "origin code", "country", false, ["Category", "Country", "Text"]],
      [8, "lat", "latitude", true, ["Number", "Latitude", "Longitude", "Category"]],
    ]);
  });

  test("a page is fetched for the numbers, of any sub-role, and the texts", () => {
    expect(fetchedColumns(PLANTS)).toEqual([1, 3, 5, 8]);
  });
});

describe("a row of the table", () => {
  test("has a cell per column, in the order of the table, with the decimal mark given", () => {
    expect(tableRow(PLANTS, PAGE, row(2), codesOf, null, ",")).toEqual({
      row: 2,
      selected: false,
      cells: [
        { kind: "value", text: "p3", align: "start" },
        { kind: "value", text: "2,5", align: "end" },
        { kind: "missing" },
        { kind: "missing" },
        { kind: "value", text: "TRUE", align: "start" },
        { kind: "value", text: "tall", align: "start" },
        { kind: "value", text: "2", align: "end" },
        { kind: "missing" },
        { kind: "value", text: "40,5", align: "end" },
      ],
    });
    expect(tableRow(PLANTS, PAGE, row(3), codesOf, null, ",").cells).toEqual([
      { kind: "value", text: "p4", align: "start" },
      { kind: "missing" },
      { kind: "value", text: "Peru", align: "start" },
      { kind: "value", text: "-7", align: "end" },
      { kind: "missing" },
      { kind: "missing" },
      { kind: "value", text: "0,5", align: "end" },
      { kind: "value", text: "ESP", align: "start" },
      { kind: "value", text: "-12", align: "end" },
    ]);
  });

  test("is selected when the selection holds it", () => {
    const selection = rangeBits(4, 1, 2);
    expect(tableRow(PLANTS, PAGE, row(2), codesOf, selection, ".").selected).toBe(true);
    expect(tableRow(PLANTS, PAGE, row(3), codesOf, selection, ".").selected).toBe(false);
  });

  test("has no cells while its page is being fetched", () => {
    expect(tableRow(PLANTS, null, row(1), codesOf, rangeBits(4, 1, 1), ".")).toEqual({
      row: 1,
      selected: true,
      cells: null,
    });
  });

  test("outside its page, or with a column the page lacks, is a defect", () => {
    expect(() => tableRow(PLANTS, PAGE, row(1), codesOf, null, ".")).toThrow(
      /defect: row 1 drawn from a page of 2 rows from row 2/,
    );
    const lacking = { ...PAGE, columns: PAGE.columns.slice(1) };
    expect(() => tableRow(PLANTS, lacking, row(2), codesOf, null, ".")).toThrow(
      /defect: a page of rows without the values of column 5/,
    );
  });

  test("with a code that has no level is a defect", () => {
    const codes = new Uint16Array([0, 1, 7, 1]);
    expect(() => tableRow(PLANTS, PAGE, row(2), () => codes, null, ".")).toThrow(
      /defect: a code 7 with no level in column 2/,
    );
  });
});
