import { describe, expect, test } from "vitest";

import { isLevelCode } from "./ids.ts";
import type { LevelCode } from "./ids.ts";
import type { Selected } from "./message.ts";
import {
  holdsCode,
  rangeOf,
  removableGroups,
  sameSelection,
  selectionOrdered,
  singleOf,
  toggled,
} from "./selectedGroups.ts";

function code(value: number): LevelCode {
  if (!isLevelCode(value)) throw new Error("not a code");
  return value;
}
function group(value: number): Selected {
  return { kind: "group", code: code(value) };
}
const UNASSIGNED: Selected = { kind: "unassigned" };

describe("a selection of groups", () => {
  test("is kept in the core's order: the groups by code, then the unassigned", () => {
    expect(selectionOrdered([UNASSIGNED, group(3), group(0)])).toEqual([
      group(0),
      group(3),
      UNASSIGNED,
    ]);
  });

  test("has a single row only when exactly one is selected", () => {
    expect(singleOf([group(2)])).toEqual(group(2));
    expect(singleOf([UNASSIGNED])).toEqual(UNASSIGNED);
    expect(singleOf([])).toBeNull();
    expect(singleOf([group(0), UNASSIGNED])).toBeNull();
  });

  test("holds an individual of a group selected, or an unassigned one when they are", () => {
    const selected = [group(1), UNASSIGNED];
    expect(holdsCode(selected, code(1))).toBe(true);
    expect(holdsCode(selected, code(0))).toBe(false);
    expect(holdsCode(selected, null)).toBe(true);
    expect(holdsCode([group(1)], null)).toBe(false);
  });

  test("gives − the groups it holds, not the unassigned", () => {
    expect(removableGroups([group(0), group(4), UNASSIGNED])).toEqual([code(0), code(4)]);
    expect(removableGroups([UNASSIGNED])).toEqual([]);
  });

  test("toggled adds a row not selected and takes away one that is", () => {
    expect(toggled([group(2)], group(0))).toEqual([group(0), group(2)]);
    expect(toggled([group(0), group(2)], group(0))).toEqual([group(2)]);
    expect(toggled([], UNASSIGNED)).toEqual([UNASSIGNED]);
  });

  test("is the same as another of the same rows in any order", () => {
    expect(sameSelection([group(0), UNASSIGNED], [UNASSIGNED, group(0)])).toBe(true);
    expect(sameSelection([group(0)], [group(1)])).toBe(false);
    expect(sameSelection([group(0)], [group(0), UNASSIGNED])).toBe(false);
  });

  test("of a range is every row from the anchor to the row, either way", () => {
    const rows = [group(0), group(1), group(2), UNASSIGNED];
    expect(rangeOf(rows, group(1), UNASSIGNED)).toEqual([group(1), group(2), UNASSIGNED]);
    expect(rangeOf(rows, group(2), group(0))).toEqual([group(0), group(1), group(2)]);
    expect(rangeOf(rows, group(1), group(1))).toEqual([group(1)]);
  });

  test("of a range with no anchor, or one gone, is the row alone", () => {
    const rows = [group(0), group(1)];
    expect(rangeOf(rows, null, group(1))).toEqual([group(1)]);
    expect(rangeOf(rows, group(5), group(0))).toEqual([group(0)]);
  });
});
