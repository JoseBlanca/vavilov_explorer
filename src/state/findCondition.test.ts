import { describe, expect, test } from "vitest";

import type { ColumnDescription, TableDescription } from "./description.ts";
import type { Condition, Filter } from "./filter.ts";
import {
  OPERATORS,
  clearedFilterMessage,
  conditionForColumn,
  conditionOf,
  conditionText,
  operatorOf,
  searchedOf,
} from "./findCondition.ts";
import { isColumnId, isLevelCode, isRevision } from "./ids.ts";
import type { ColumnId, LevelCode, Revision } from "./ids.ts";

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

const AT = revision(1);

/** IDs at 0; 1 height, a number; 2 origin, a category; 3 country; 4 note, text; 5 lat. */
const COLUMNS: readonly ColumnDescription[] = [
  {
    id: id(1),
    name: "height",
    revision: AT,
    roles: ["number"],
    storage: "float",
    role: "number",
  },
  {
    id: id(2),
    name: "origin",
    revision: AT,
    roles: ["category"],
    storage: "text",
    role: "category",
    levels: [],
  },
  {
    id: id(3),
    name: "country",
    revision: AT,
    roles: ["country"],
    storage: "text",
    role: "country",
    levels: [],
  },
  { id: id(4), name: "note", revision: AT, roles: ["text"], storage: "text", role: "text" },
  {
    id: id(5),
    name: "lat",
    revision: AT,
    roles: ["latitude"],
    storage: "float",
    role: "latitude",
  },
];

const TABLE: TableDescription = {
  loadedAt: AT,
  shapeAt: AT,
  numRows: 3,
  names: { id: id(0), header: "IndividualID" },
  columns: COLUMNS,
};

const GROUPS = ["Spain", "Peru"];

describe("the operators of a column", () => {
  test("depend on what it holds, any column holding texts", () => {
    expect(searchedOf(TABLE, null)).toBe("texts");
    expect(searchedOf(TABLE, id(0))).toBe("texts");
    expect(searchedOf(TABLE, id(1))).toBe("numbers");
    expect(searchedOf(TABLE, id(5))).toBe("numbers");
    expect(searchedOf(TABLE, id(2))).toBe("groups");
    expect(searchedOf(TABLE, id(3))).toBe("groups");
    expect(searchedOf(TABLE, id(4))).toBe("texts");
  });

  test("are words for texts and groups, and symbols for numbers, each with is missing", () => {
    expect(OPERATORS.texts).toEqual(["contains", "is", "missing"]);
    expect(OPERATORS.groups).toEqual(["contains", "is", "missing"]);
    expect(OPERATORS.numbers).toEqual(["equal", "less", "atMost", "greater", "atLeast", "missing"]);
  });

  test("of a condition: a group is chosen by is", () => {
    expect(operatorOf({ kind: "group", code: null })).toBe("is");
    expect(operatorOf({ kind: "compare", comparison: "atMost", text: "2" })).toBe("atMost");
    expect(operatorOf({ kind: "missing" })).toBe("missing");
  });
});

describe("the condition of an operator", () => {
  const contains: Condition = { kind: "contains", text: "peru" };

  test("keeps the text typed", () => {
    expect(conditionOf("is", "texts", contains, [])).toEqual({ kind: "is", text: "peru" });
    expect(conditionOf("atLeast", "numbers", { kind: "contains", text: "2" }, [])).toEqual({
      kind: "compare",
      comparison: "atLeast",
      text: "2",
    });
    expect(conditionOf("missing", "texts", contains, [])).toEqual({ kind: "missing" });
    expect(conditionOf("contains", "texts", { kind: "missing" }, [])).toEqual({
      kind: "contains",
      text: "",
    });
  });

  test("is on a column of groups chooses the group the text names, or none", () => {
    expect(conditionOf("is", "groups", contains, GROUPS)).toEqual({ kind: "group", code: code(1) });
    expect(conditionOf("is", "groups", { kind: "contains", text: "pe" }, GROUPS)).toEqual({
      kind: "group",
      code: null,
    });
  });

  test("of a group's text is the group's name", () => {
    expect(conditionText({ kind: "group", code: code(0) }, GROUPS)).toBe("Spain");
    expect(conditionText({ kind: "group", code: null }, GROUPS)).toBe("");
    expect(conditionText({ kind: "missing" }, GROUPS)).toBe("");
    expect(conditionText({ kind: "compare", comparison: "less", text: "1,5" }, GROUPS)).toBe("1,5");
    expect(conditionOf("contains", "groups", { kind: "group", code: code(0) }, GROUPS)).toEqual({
      kind: "contains",
      text: "Spain",
    });
  });
});

describe("the condition when another column is chosen", () => {
  test("keeps its operator when the column offers it, else takes the first with its text", () => {
    const contains: Condition = { kind: "contains", text: "2" };
    expect(conditionForColumn(contains, [], "texts", [])).toEqual(contains);
    expect(conditionForColumn(contains, [], "numbers", [])).toEqual({
      kind: "compare",
      comparison: "equal",
      text: "2",
    });
    const atMost: Condition = { kind: "compare", comparison: "atMost", text: "2" };
    expect(conditionForColumn(atMost, [], "texts", [])).toEqual({ kind: "contains", text: "2" });
    expect(conditionForColumn({ kind: "missing" }, [], "numbers", [])).toEqual({ kind: "missing" });
  });

  test("names a group chosen by its name, to choose it again in another column", () => {
    const spain: Condition = { kind: "group", code: code(0) };
    expect(conditionForColumn(spain, GROUPS, "groups", ["Peru", "Spain"])).toEqual({
      kind: "group",
      code: code(1),
    });
    expect(conditionForColumn(spain, GROUPS, "texts", [])).toEqual({ kind: "is", text: "Spain" });
  });
});

describe("the words of a filter the backend cleared", () => {
  const of = (column: number, condition: Condition): Filter => ({
    column: id(column),
    condition,
    showing: "matching",
  });
  const names = { column: "origin", group: "ESP" };

  test("say the group was deleted, or the column changed role", () => {
    expect(
      clearedFilterMessage(
        of(2, { kind: "group", code: code(0) }),
        of(2, { kind: "contains", text: "" }),
        names,
        true,
      ),
    ).toEqual({
      kind: "information",
      text: "The filter on ESP was removed: the group was deleted.",
    });
    expect(
      clearedFilterMessage(
        of(1, { kind: "compare", comparison: "atMost", text: "2" }),
        of(1, { kind: "contains", text: "" }),
        { column: "height", group: null },
        false,
      ),
    ).toEqual({
      kind: "information",
      text: "The filter on height was removed: its column changed role.",
    });
  });

  test("are none for a filter with no value, or one not cleared", () => {
    expect(
      clearedFilterMessage(
        of(2, { kind: "group", code: null }),
        of(2, { kind: "contains", text: "" }),
        names,
        true,
      ),
    ).toBeNull();
    expect(
      clearedFilterMessage(
        of(2, { kind: "group", code: code(1) }),
        of(2, { kind: "group", code: code(0) }),
        names,
        true,
      ),
    ).toBeNull();
    expect(
      clearedFilterMessage(
        of(1, { kind: "contains", text: "x" }),
        of(4, { kind: "contains", text: "" }),
        names,
        false,
      ),
    ).toBeNull();
  });
});
