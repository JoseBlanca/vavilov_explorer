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

/** Four plants: 1 height, 2 origin (Spain, Peru), 3 seeds, 4 fertile, 5 note. */
const PLANTS: TableDescription = {
  loadedAt: revision(1),
  numRows: 4,
  names: { id: column(0), header: "accession" },
  columns: [
    { id: column(1), name: "height", revision: revision(1), type: "numeric" },
    {
      id: column(2),
      name: "origin",
      revision: revision(1),
      type: "categorical",
      levels: [
        { name: "Spain", colour: "#e69f00" },
        { name: "Peru", colour: "#56b4e9" },
      ],
    },
    { id: column(3), name: "seeds", revision: revision(1), type: "integer" },
    { id: column(4), name: "fertile", revision: revision(1), type: "boolean" },
    { id: column(5), name: "note", revision: revision(1), type: "text" },
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
    { id: column(5), revision: revision(1), type: "text", values: ["", null] },
    { id: column(1), revision: revision(1), type: "numeric", values: [2.5, null] },
    { id: column(3), revision: revision(1), type: "integer", values: [null, -7n] },
    { id: column(4), revision: revision(1), type: "boolean", values: [true, null] },
  ],
};

/** The codes of origin: Spain, Peru, missing, Peru. */
const CODES = new Uint16Array([0, 1, 0xffff, 1]);
const codesOf = (id: ColumnId): Uint16Array | null => (id === 2 ? CODES : null);

describe("the columns of the table", () => {
  test("are the names, then every column in the order of the table", () => {
    expect(tableColumns(PLANTS).map((c) => [c.id, c.name, c.type])).toEqual([
      [0, "accession", "names"],
      [1, "height", "numeric"],
      [2, "origin", "categorical"],
      [3, "seeds", "integer"],
      [4, "fertile", "boolean"],
      [5, "note", "text"],
    ]);
  });

  test("a page is fetched for every column but the categorical ones", () => {
    expect(fetchedColumns(PLANTS)).toEqual([1, 3, 4, 5]);
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
        { kind: "value", text: "", align: "start" },
      ],
    });
    expect(tableRow(PLANTS, PAGE, row(3), codesOf, null, ".").cells).toEqual([
      { kind: "value", text: "p4", align: "start" },
      { kind: "missing" },
      { kind: "value", text: "Peru", align: "start" },
      { kind: "value", text: "-7", align: "end" },
      { kind: "missing" },
      { kind: "missing" },
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
