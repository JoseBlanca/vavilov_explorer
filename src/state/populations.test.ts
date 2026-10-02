import { describe, expect, test } from "vitest";

import type { TableDescription } from "./description.ts";
import { isColumnId, isLevelCode, isRevision } from "./ids.ts";
import type { ColumnId, LevelCode, Revision } from "./ids.ts";
import { populationsModel, sameSelected } from "./populations.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}
function code(value: number): LevelCode {
  if (!isLevelCode(value)) throw new Error("not a code");
  return value;
}
function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
  return value;
}

const ORIGIN = column(2);
const CLUSTER = column(4);

/**
 * Six plants: height; origin (Spain, Peru, Chile), a classification of
 * text; seeds; cluster (1, 20), a classification of whole numbers.
 */
const DESCRIPTION: TableDescription = {
  loadedAt: revision(1),
  shapeAt: revision(1),
  numRows: 6,
  names: { id: column(0), header: "accession" },
  columns: [
    {
      id: column(1),
      name: "height",
      revision: revision(1),
      storage: "float",
      role: "number",
      numDistinct: 6,
    },
    {
      id: ORIGIN,
      name: "origin",
      revision: revision(1),
      storage: "text",
      role: "classification",
      levels: [
        { value: "Spain", colour: "#e69f00" },
        { value: "Peru", colour: "#56b4e9" },
        { value: "Chile", colour: "#009e73" },
      ],
    },
    {
      id: column(3),
      name: "seeds",
      revision: revision(1),
      storage: "integer",
      role: "number",
      numDistinct: 6,
    },
    {
      id: CLUSTER,
      name: "cluster",
      revision: revision(1),
      storage: "integer",
      role: "classification",
      levels: [
        { value: "1", colour: "#0072b2" },
        { value: "20", colour: "#d55e00" },
      ],
    },
  ],
};

/** origin: Spain, Peru, missing, Spain, missing, Peru; Chile has no one. */
const CODES = new Map<number, Uint16Array>([
  [ORIGIN, new Uint16Array([0, 1, 0xffff, 0, 0xffff, 1])],
  [CLUSTER, new Uint16Array([0, 0, 0, 0, 0, 1])],
]);
const codesOf = (id: ColumnId): Uint16Array | null => CODES.get(id) ?? null;

describe("the populations panel's model", () => {
  test("lists every classification to choose", () => {
    const model = populationsModel(DESCRIPTION, null, codesOf, ",");
    expect(model.classifications).toEqual([
      { column: 2, name: "origin" },
      { column: 4, name: "cluster" },
    ]);
    expect(model.active).toBeNull();
    expect(model.rows).toEqual([]);
  });

  test("gives each population its colour and count, an empty one too, and the unassigned last", () => {
    const model = populationsModel(DESCRIPTION, { column: ORIGIN, selected: null }, codesOf, ",");
    expect(model.active).toBe(2);
    expect(model.rows).toEqual([
      {
        selected: { kind: "population", code: 0 },
        name: "Spain",
        colour: "#e69f00",
        count: 2,
        isSelected: false,
      },
      {
        selected: { kind: "population", code: 1 },
        name: "Peru",
        colour: "#56b4e9",
        count: 2,
        isSelected: false,
      },
      {
        selected: { kind: "population", code: 2 },
        name: "Chile",
        colour: "#009e73",
        count: 0,
        isSelected: false,
      },
      { selected: { kind: "unassigned" }, name: null, colour: null, count: 2, isSelected: false },
    ]);
  });

  test("marks the selected row, a population or the unassigned", () => {
    const peru = populationsModel(
      DESCRIPTION,
      { column: ORIGIN, selected: { kind: "population", code: code(1) } },
      codesOf,
      ",",
    );
    expect(peru.rows.map((row) => row.isSelected)).toEqual([false, true, false, false]);
    const unassigned = populationsModel(
      DESCRIPTION,
      { column: ORIGIN, selected: { kind: "unassigned" } },
      codesOf,
      ",",
    );
    expect(unassigned.rows.map((row) => row.isSelected)).toEqual([false, false, false, true]);
  });

  test("counts the active classification, not another, its levels of numbers as text", () => {
    const model = populationsModel(DESCRIPTION, { column: CLUSTER, selected: null }, codesOf, ",");
    expect(model.rows.map((row) => [row.name, row.count])).toEqual([
      ["1", 5],
      ["20", 1],
      [null, 0],
    ]);
  });

  test("codes that do not fit the levels or the table are a defect", () => {
    const tooHigh = (): Uint16Array => new Uint16Array([0, 3, 0, 0, 0, 0]);
    expect(() =>
      populationsModel(DESCRIPTION, { column: ORIGIN, selected: null }, tooHigh, ","),
    ).toThrow(/defect.*code 3.*3 levels/);
    const short = (): Uint16Array => new Uint16Array([0, 1]);
    expect(() =>
      populationsModel(DESCRIPTION, { column: ORIGIN, selected: null }, short, ","),
    ).toThrow(/defect.*2 codes.*6 rows/);
    const none = (): null => null;
    expect(() =>
      populationsModel(DESCRIPTION, { column: ORIGIN, selected: null }, none, ","),
    ).toThrow(/defect.*no codes/);
    expect(() =>
      populationsModel(DESCRIPTION, { column: column(1), selected: null }, codesOf, ","),
    ).toThrow(/defect.*column 1.*not a classification/);
  });
});

describe("two selections", () => {
  test("are the same when they select the same thing", () => {
    expect(sameSelected(null, null)).toBe(true);
    expect(sameSelected({ kind: "unassigned" }, { kind: "unassigned" })).toBe(true);
    expect(
      sameSelected({ kind: "population", code: code(1) }, { kind: "population", code: code(1) }),
    ).toBe(true);
    expect(
      sameSelected({ kind: "population", code: code(1) }, { kind: "population", code: code(2) }),
    ).toBe(false);
    expect(sameSelected({ kind: "population", code: code(1) }, { kind: "unassigned" })).toBe(false);
    expect(sameSelected(null, { kind: "unassigned" })).toBe(false);
  });
});
