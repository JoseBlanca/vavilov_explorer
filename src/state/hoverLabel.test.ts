import { describe, expect, test } from "vitest";

import type { TableDescription } from "./description.ts";
import { hoverLabel, labelColumns } from "./hoverLabel.ts";
import { isColumnId, isLevelCode, isPosition, isRevision, isRowIndex } from "./ids.ts";
import type { ColumnId, LevelCode, Position, Revision, RowIndex } from "./ids.ts";
import type { PageColumn, RowPage } from "./rowPage.ts";

function id(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}
function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
  return value;
}
function code(value: number): LevelCode {
  if (!isLevelCode(value)) throw new Error("not a code");
  return value;
}
function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error("not a row");
  return value;
}
function position(value: number): Position {
  if (!isPosition(value)) throw new Error("not a position");
  return value;
}

const AT = revision(1);
const ORIGIN = id(1);

/** origin, the active classification; height; seeds; cluster; note. */
const DESCRIPTION: TableDescription = {
  loadedAt: AT,
  shapeAt: AT,
  numRows: 4,
  names: { id: id(0), header: "IndividualID" },
  columns: [
    {
      id: ORIGIN,
      name: "origin",
      revision: AT,
      storage: "text",
      role: "category",
      roles: ["category"],
      levels: [
        { value: "Spain", colour: "#e69f00" },
        { value: "Peru", colour: "#56b4e9" },
      ],
    },
    {
      id: id(2),
      name: "height",
      revision: AT,
      storage: "float",
      role: "number",
      roles: ["number"],
    },
    {
      id: id(3),
      name: "seeds",
      revision: AT,
      storage: "integer",
      role: "number",
      roles: ["number"],
    },
    {
      id: id(4),
      name: "cluster",
      revision: AT,
      storage: "text",
      role: "category",
      roles: ["category"],
      levels: [{ value: "A", colour: "#e69f00" }],
    },
    { id: id(5), name: "note", revision: AT, storage: "text", role: "text", roles: ["text"] },
  ],
};

function page(columns: readonly PageColumn[]): RowPage {
  return {
    revision: AT,
    loadedAt: AT,
    shownAt: AT,
    namesAt: AT,
    first: position(0),
    count: 1,
    rows: [row(2)],
    names: ["p3"],
    columns,
  };
}

describe("labelColumns", () => {
  test("are the first three columns but the active classification", () => {
    expect(labelColumns(DESCRIPTION, ORIGIN).map((column) => column.name)).toEqual([
      "height",
      "seeds",
      "cluster",
    ]);
    expect(labelColumns(DESCRIPTION, null).map((column) => column.name)).toEqual([
      "origin",
      "height",
      "seeds",
    ]);
  });
});

describe("hoverLabel", () => {
  const values: readonly PageColumn[] = [
    { id: id(2), revision: AT, type: "float", values: [1.5] },
    { id: id(3), revision: AT, type: "integer", values: [null] },
    { id: id(4), revision: AT, type: "categorical", codes: [code(0)] },
  ];

  test("names the individual, its group and its values, a decimal with the region's mark", () => {
    expect(hoverLabel(DESCRIPTION, ORIGIN, 1, page(values), ",")).toEqual({
      title: "p3",
      lines: [
        { name: "origin", value: "Peru" },
        { name: "height", value: "1,5" },
        { name: "seeds", value: "missing" },
        { name: "cluster", value: "A" },
      ],
    });
  });

  test("names an individual of no group unassigned", () => {
    const label = hoverLabel(DESCRIPTION, ORIGIN, 0xffff, page(values), ".");
    expect(label.lines[0]).toEqual({ name: "origin", value: "Unassigned" });
  });

  test("a page whose columns are not the label's is a defect", () => {
    expect(() => hoverLabel(DESCRIPTION, ORIGIN, 0, page(values.slice(1)), ".")).toThrow(
      /2 columns for 3/,
    );
  });
});
