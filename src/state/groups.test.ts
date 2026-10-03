import { describe, expect, test } from "vitest";

import type { TableDescription } from "./description.ts";
import { isColumnId, isLevelCode, isRevision } from "./ids.ts";
import type { ColumnId, LevelCode, Revision } from "./ids.ts";
import { isCategoricalColumn } from "./description.ts";
import { colourChoices, groupsModel, sameSelected } from "./groups.ts";
import type { GroupRow } from "./groups.ts";

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
const FERTILE = column(5);

/**
 * Six plants: height; origin (Spain, Peru, Chile), a category of text;
 * seeds; cluster (1, 20), a category of whole numbers; fertile (FALSE,
 * TRUE), a category of yes or no.
 */
const DESCRIPTION: TableDescription = {
  loadedAt: revision(1),
  shapeAt: revision(1),
  numRows: 6,
  names: { id: column(0), header: "IndividualID" },
  columns: [
    {
      id: column(1),
      name: "height",
      revision: revision(1),
      storage: "float",
      role: "number",
      roles: ["number"],
    },
    {
      id: ORIGIN,
      name: "origin",
      revision: revision(1),
      storage: "text",
      role: "category",
      roles: ["category"],
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
      roles: ["number"],
    },
    {
      id: CLUSTER,
      name: "cluster",
      revision: revision(1),
      storage: "integer",
      role: "category",
      roles: ["category"],
      levels: [
        { value: "1", colour: "#0072b2" },
        { value: "20", colour: "#d55e00" },
      ],
    },
    {
      id: FERTILE,
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
  ],
};

/** origin: Spain, Peru, missing, Spain, missing, Spain; Chile has no one. */
const CODES = new Map<number, Uint16Array>([
  [ORIGIN, new Uint16Array([0, 1, 0xffff, 0, 0xffff, 0])],
  [CLUSTER, new Uint16Array([0, 0, 0, 0, 0, 1])],
  [FERTILE, new Uint16Array([1, 1, 0, 0xffff, 0, 1])],
]);
const codesOf = (id: ColumnId): Uint16Array | null => CODES.get(id) ?? null;

describe("the groups panel's model", () => {
  test("lists every category to choose as the classification", () => {
    const model = groupsModel(DESCRIPTION, null, codesOf, ",");
    expect(model.classifications).toEqual([
      { column: 2, name: "origin" },
      { column: 4, name: "cluster" },
      { column: 5, name: "fertile" },
    ]);
    expect(model.active).toBeNull();
    expect(model.rows).toEqual([]);
    expect(model.takesNewGroups).toBe(false);
  });

  test("gives each group its colour and count, an empty one too, and the unassigned last", () => {
    const model = groupsModel(
      DESCRIPTION,
      { column: ORIGIN, selected: null, mode: null },
      codesOf,
      ",",
    );
    expect(model.active).toBe(2);
    expect(model.activeName).toBe("origin");
    expect(model.nameLimit).toBe(30);
    expect(model.takesNewGroups).toBe(true);
    expect(model.rows).toEqual([
      {
        selected: { kind: "group", code: 0 },
        name: "Spain",
        colour: "#e69f00",
        count: 3,
        isSelected: false,
      },
      {
        selected: { kind: "group", code: 1 },
        name: "Peru",
        colour: "#56b4e9",
        count: 1,
        isSelected: false,
      },
      {
        selected: { kind: "group", code: 2 },
        name: "Chile",
        colour: "#009e73",
        count: 0,
        isSelected: false,
      },
      { selected: { kind: "unassigned" }, name: null, colour: null, count: 2, isSelected: false },
    ]);
  });

  test("marks the selected row, a group or the unassigned", () => {
    const peru = groupsModel(
      DESCRIPTION,
      { column: ORIGIN, selected: { kind: "group", code: code(1) }, mode: "remove" },
      codesOf,
      ",",
    );
    expect(peru.rows.map((row) => row.isSelected)).toEqual([false, true, false, false]);
    expect(peru.mode).toBe("remove");
    const unassigned = groupsModel(
      DESCRIPTION,
      { column: ORIGIN, selected: { kind: "unassigned" }, mode: null },
      codesOf,
      ",",
    );
    expect(unassigned.rows.map((row) => row.isSelected)).toEqual([false, false, false, true]);
  });

  test("of a classification of TRUE and FALSE takes a new group only while it lacks one", () => {
    const model = groupsModel(
      DESCRIPTION,
      { column: FERTILE, selected: null, mode: null },
      codesOf,
      ",",
    );
    expect(model.rows.map((row) => [row.name, row.count])).toEqual([
      ["FALSE", 2],
      ["TRUE", 3],
      [null, 1],
    ]);
    expect(model.takesNewGroups).toBe(false);
    expect(model.nameLimit).toBeNull();
    const onlyTrue: TableDescription = {
      ...DESCRIPTION,
      columns: DESCRIPTION.columns.map((column) =>
        column.id === FERTILE && isCategoricalColumn(column)
          ? { ...column, levels: column.levels.slice(1) }
          : column,
      ),
    };
    const lacking = groupsModel(
      onlyTrue,
      { column: FERTILE, selected: null, mode: null },
      () => new Uint16Array([0, 0, 0, 0xffff, 0, 0]),
      ",",
    );
    expect(lacking.takesNewGroups).toBe(true);
    const cluster = groupsModel(
      DESCRIPTION,
      { column: CLUSTER, selected: null, mode: null },
      codesOf,
      ",",
    );
    expect(cluster.takesNewGroups).toBe(true);
    expect(cluster.nameLimit).toBeNull();
  });

  test("counts the active classification, not another, its levels of numbers as text", () => {
    const model = groupsModel(
      DESCRIPTION,
      { column: CLUSTER, selected: null, mode: null },
      codesOf,
      ",",
    );
    expect(model.rows.map((row) => [row.name, row.count])).toEqual([
      ["1", 5],
      ["20", 1],
      [null, 0],
    ]);
  });

  test("codes that do not fit the levels or the table are a defect", () => {
    const tooHigh = (): Uint16Array => new Uint16Array([0, 3, 0, 0, 0, 0]);
    expect(() =>
      groupsModel(DESCRIPTION, { column: ORIGIN, selected: null, mode: null }, tooHigh, ","),
    ).toThrow(/defect.*code 3.*3 levels/);
    const short = (): Uint16Array => new Uint16Array([0, 1]);
    expect(() =>
      groupsModel(DESCRIPTION, { column: ORIGIN, selected: null, mode: null }, short, ","),
    ).toThrow(/defect.*2 codes.*6 rows/);
    const none = (): null => null;
    expect(() =>
      groupsModel(DESCRIPTION, { column: ORIGIN, selected: null, mode: null }, none, ","),
    ).toThrow(/defect.*no codes/);
    expect(() =>
      groupsModel(DESCRIPTION, { column: column(1), selected: null, mode: null }, codesOf, ","),
    ).toThrow(/defect.*column 1.*not a category/);
  });
});

describe("two selections", () => {
  test("are the same when they select the same thing", () => {
    expect(sameSelected(null, null)).toBe(true);
    expect(sameSelected({ kind: "unassigned" }, { kind: "unassigned" })).toBe(true);
    expect(sameSelected({ kind: "group", code: code(1) }, { kind: "group", code: code(1) })).toBe(
      true,
    );
    expect(sameSelected({ kind: "group", code: code(1) }, { kind: "group", code: code(2) })).toBe(
      false,
    );
    expect(sameSelected({ kind: "group", code: code(1) }, { kind: "unassigned" })).toBe(false);
    expect(sameSelected(null, { kind: "unassigned" })).toBe(false);
  });
});

describe("the colours a group edited can take", () => {
  /** A row of a group of `colour`, not selected and empty. */
  function row(at: number, name: string, colour: string): GroupRow {
    return {
      selected: { kind: "group", code: code(at) },
      name,
      colour,
      count: 0,
      isSelected: false,
    };
  }
  const rows: readonly GroupRow[] = [
    row(0, "Spain", "#e69f00"),
    row(1, "Peru", "#56b4e9"),
    row(2, "Chile", "#56b4e9"),
    row(3, "Japan", "#009e73"),
    { selected: { kind: "unassigned" }, name: null, colour: null, count: 3, isSelected: false },
  ];

  test("are the whole list, each named with the other groups that have it", () => {
    const choices = colourChoices(rows, code(3), String);
    expect(choices).toHaveLength(21);
    expect(choices.slice(0, 4)).toEqual([
      { colour: "#e69f00", label: "Orange, used by Spain" },
      { colour: "#56b4e9", label: "Sky blue, used by 2 groups" },
      // Japan's own colour is not used by another group.
      { colour: "#009e73", label: "Bluish green" },
      { colour: "#f0e442", label: "Yellow" },
    ]);
  });
});
