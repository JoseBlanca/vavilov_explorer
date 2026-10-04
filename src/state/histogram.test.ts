import { describe, expect, test } from "vitest";

import type { ColumnNumbers } from "./columnNumbers.ts";
import type { GroupRow } from "./groups.ts";
import {
  STARTING_BINS,
  binsOf,
  edgesOf,
  roundedEdge,
  rowsOfPart,
  samePart,
  segmentText,
  stackOf,
} from "./histogram.ts";
import type { Bins, Part, PartColours, Segment } from "./histogram.ts";
import { NO_CODE, isColumnId, isLevelCode, isRevision } from "./ids.ts";
import type { LevelCode } from "./ids.ts";
import { placedRows } from "./placed.ts";
import { hasRow, rowsWhere } from "./rowSet.ts";

/** A column of `values`, `null` for a missing one, as fetch_column gives it around `centre`. */
function numbers(centre: number, values: readonly (number | null)[]): ColumnNumbers {
  const column = 2;
  const revision = 1;
  if (!isColumnId(column) || !isRevision(revision)) throw new Error("no ids");
  return {
    column,
    revision,
    centre,
    values: Float32Array.from(values, (value) => (value === null ? 0 : value - centre)),
    missing: rowsWhere(values.length, (row) => values[row] === null),
  };
}

function binsOfValues(centre: number, values: readonly (number | null)[], count: number): Bins {
  const column = numbers(centre, values);
  return binsOf(column, placedRows([column], values.length), count);
}

/** The rows of a set of rows, one bit each, among the first `numRows`. */
function rowsIn(bits: Uint8Array, numRows: number): number[] {
  return [...Array(numRows).keys()].filter((row) => hasRow(bits, row));
}

function levelCode(value: number): LevelCode {
  if (!isLevelCode(value)) throw new Error("not a level code");
  return value;
}

describe("binsOf", () => {
  test("cuts the values into bins of equal width, the highest in the last", () => {
    const bins = binsOfValues(10, [5, 10, 15, 11, null], 2);
    expect(bins.lowest).toBe(5);
    expect(bins.highest).toBe(15);
    expect([...bins.ofRow]).toEqual([0, 1, 1, 1, -1]);
    expect(edgesOf(bins, 0)).toEqual({ low: 5, high: 10 });
    expect(edgesOf(bins, 1)).toEqual({ low: 10, high: 15 });
  });

  test("starts with 20 bins", () => {
    expect(STARTING_BINS).toBe(20);
    const bins = binsOfValues(10, [0, 1, 19, 20], STARTING_BINS);
    expect([...bins.ofRow]).toEqual([0, 1, 19, 19]);
  });

  test("of one value span one unit around it", () => {
    const bins = binsOfValues(3, [3, 3], STARTING_BINS);
    expect(bins.lowest).toBe(2.5);
    expect(bins.highest).toBe(3.5);
    expect([...bins.ofRow]).toEqual([10, 10]);
  });

  test("with no value drawn hold none", () => {
    const bins = binsOfValues(0, [null, null], STARTING_BINS);
    expect(bins.lowest).toBe(0);
    expect(bins.highest).toBe(1);
    expect([...bins.ofRow]).toEqual([-1, -1]);
  });
});

/**
 * Six individuals: rows 0, 1 and 2 in bin 0, rows 3 and 4 in bin 1, and row
 * 5 not drawn; by farm, North (0), South (1) and unassigned: North, South,
 * none, North, North, South; rows 1 and 3 selected.
 */
const BINS: Bins = { lowest: 0, highest: 2, count: 2, ofRow: Int16Array.from([0, 0, 0, 1, 1, -1]) };
const FARMS = new Uint16Array([0, 1, NO_CODE, 0, 0, 1]);
const SELECTION = rowsWhere(6, (row) => row === 1 || row === 3);
const COLOURS: PartColours = { unassigned: "grey", others: "silver", unclassified: "blue" };

/** The rows of the panel for the farms, with those named in `chosen` selected, `null` for the unassigned. */
function farmRows(chosen: readonly (string | null)[]): readonly GroupRow[] {
  const row = (name: string | null, code: number | null, colour: string | null): GroupRow => ({
    selected: code === null ? { kind: "unassigned" } : { kind: "group", code: levelCode(code) },
    name,
    colour,
    count: 0,
    isSelected: chosen.includes(name),
    showsPlus: false,
    showsMinus: false,
  });
  return [row("North", 0, "#e69f00"), row("South", 1, "#56b4e9"), row(null, null, null)];
}

const NORTH: Part = { kind: "row", row: { kind: "group", code: levelCode(0) } };
const SOUTH: Part = { kind: "row", row: { kind: "group", code: levelCode(1) } };
const UNASSIGNED: Part = { kind: "row", row: { kind: "unassigned" } };
const OTHERS: Part = { kind: "others" };
const ALL: Part = { kind: "all" };

/** The segments as [bin, part, colour, bottom, count, selected]. */
function shapes(segments: readonly Segment[]): unknown[] {
  return segments.map((segment) => [
    segment.bin,
    segment.part,
    segment.colour,
    segment.bottom,
    segment.count,
    segment.selected,
  ]);
}

describe("stackOf", () => {
  test("with no active classification draws one segment a bar", () => {
    const stack = stackOf({
      bins: BINS,
      codes: null,
      rows: [],
      selection: SELECTION,
      colours: COLOURS,
    });
    expect(shapes(stack.segments)).toEqual([
      [0, ALL, "blue", 0, 3, 1],
      [1, ALL, "blue", 0, 2, 1],
    ]);
    expect(stack.tallest).toBe(3);
  });

  test("with no group selected stacks every row of the panel in its order", () => {
    const stack = stackOf({
      bins: BINS,
      codes: FARMS,
      rows: farmRows([]),
      selection: SELECTION,
      colours: COLOURS,
    });
    expect(shapes(stack.segments)).toEqual([
      [0, NORTH, "#e69f00", 0, 1, 0],
      [0, SOUTH, "#56b4e9", 1, 1, 1],
      [0, UNASSIGNED, "grey", 2, 1, 0],
      [1, NORTH, "#e69f00", 0, 2, 1],
    ]);
    expect(stack.segments.map((segment) => segment.name)).toEqual([
      "North",
      "South",
      null,
      "North",
    ]);
    expect(stack.tallest).toBe(3);
  });

  test("with groups selected puts them at the bottom and every other individual above", () => {
    const stack = stackOf({
      bins: BINS,
      codes: FARMS,
      rows: farmRows(["South"]),
      selection: SELECTION,
      colours: COLOURS,
    });
    expect(shapes(stack.segments)).toEqual([
      [0, SOUTH, "#56b4e9", 0, 1, 1],
      [0, OTHERS, "silver", 1, 2, 0],
      [1, OTHERS, "silver", 0, 2, 1],
    ]);
  });

  test("with the unassigned selected draws them in their grey at the bottom", () => {
    const stack = stackOf({
      bins: BINS,
      codes: FARMS,
      rows: farmRows([null, "North"]),
      selection: null,
      colours: COLOURS,
    });
    expect(shapes(stack.segments)).toEqual([
      [0, NORTH, "#e69f00", 0, 1, 0],
      [0, UNASSIGNED, "grey", 1, 1, 0],
      [0, OTHERS, "silver", 2, 1, 0],
      [1, NORTH, "#e69f00", 0, 2, 0],
    ]);
  });

  test("of codes of another table is a defect", () => {
    expect(() =>
      stackOf({
        bins: BINS,
        codes: new Uint16Array(2),
        rows: farmRows([]),
        selection: null,
        colours: COLOURS,
      }),
    ).toThrow(/defect/);
  });
});

describe("rowsOfPart", () => {
  const south = [{ kind: "group", code: levelCode(1) }] as const;

  test("are the individuals of a part in a run of bins", () => {
    expect(rowsIn(rowsOfPart(BINS, FARMS, south, OTHERS, 0, 0), 6)).toEqual([0, 2]);
    expect(rowsIn(rowsOfPart(BINS, FARMS, south, SOUTH, 1, 0), 6)).toEqual([1]);
    expect(rowsIn(rowsOfPart(BINS, FARMS, [], UNASSIGNED, 0, 1), 6)).toEqual([2]);
    expect(rowsIn(rowsOfPart(BINS, null, [], ALL, 1, 1), 6)).toEqual([3, 4]);
  });
});

describe("samePart", () => {
  test("compares the rows of the panel by group", () => {
    expect(samePart(NORTH, { kind: "row", row: { kind: "group", code: levelCode(0) } })).toBe(true);
    expect(samePart(NORTH, SOUTH)).toBe(false);
    expect(samePart(UNASSIGNED, OTHERS)).toBe(false);
    expect(samePart(OTHERS, { kind: "others" })).toBe(true);
  });
});

describe("the label of a segment", () => {
  const words = (value: number): string => value.toLocaleString("en");
  const segment = (part: Part, name: string | null, count: number): Segment => ({
    bin: 0,
    part,
    name,
    colour: "blue",
    bottom: 0,
    count,
    selected: 0,
  });

  test("names its group, its individuals and its bin", () => {
    expect(segmentText(segment(NORTH, "ESP", 1200), "1.5", "2", words)).toBe(
      "ESP: 1,200 individuals, 1.5 to 2",
    );
    expect(segmentText(segment(UNASSIGNED, null, 1), "1.5", "2", words)).toBe(
      "Unassigned: 1 individual, 1.5 to 2",
    );
    expect(segmentText(segment(OTHERS, null, 40), "1.5", "2", words)).toBe(
      "Other groups: 40 individuals, 1.5 to 2",
    );
    expect(segmentText(segment(ALL, null, 12), "1.5", "2", words)).toBe("12 individuals, 1.5 to 2");
  });

  test("rounds an edge to two significant digits of the width", () => {
    expect(roundedEdge(1.5333333, 0.5)).toBe(1.53);
    expect(roundedEdge(1234.5678, 10)).toBe(1235);
    expect(roundedEdge(0.0123456, 0.001)).toBe(0.0123);
  });
});
