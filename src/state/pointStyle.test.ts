import { describe, expect, test } from "vitest";

import { isLevelCode, isRowIndex } from "./ids.ts";
import type { LevelCode, RowIndex } from "./ids.ts";
import { MARK, pointStyle, rgbOf } from "./pointStyle.ts";
import type { PointStyleInput, Rgb } from "./pointStyle.ts";

function code(value: number): LevelCode {
  if (!isLevelCode(value)) throw new Error("not a code");
  return value;
}
function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error("not a row");
  return value;
}

const ORANGE: Rgb = [1, 0.5, 0];
const BLUE: Rgb = [0, 0, 1];
const GREY: Rgb = [0.5, 0.5, 0.5];
const BLACK: Rgb = [0, 0, 0];
const MISSING = 0xffff;

/** Five plants: Spain (0), Peru (1), unassigned, Spain, and group 21, past the list's 21 colours. */
const PLAIN: PointStyleInput = {
  numRows: 5,
  codes: new Uint16Array([0, 1, MISSING, 0, 21]),
  groupColours: [ORANGE, BLUE, ...Array.from({ length: 19 }, () => BLACK), ORANGE],
  unassigned: GREY,
  unclassified: BLACK,
  selected: [],
  selection: null,
  hover: null,
  lasso: null,
};

describe("pointStyle", () => {
  test("colours each point by its group, an unassigned one grey, every size the same", () => {
    const style = pointStyle(PLAIN);
    expect([...style.colours.slice(0, 9)]).toEqual([1, 0.5, 0, 0, 0, 1, 0.5, 0.5, 0.5]);
    expect([...style.sizes]).toEqual([8, 8, 8, 8, 8]);
    expect([...style.marks]).toEqual([0, 0, 0, 0, 0]);
  });

  test("gives the next shape to a group past the list of colours", () => {
    expect([...pointStyle(PLAIN).shapes]).toEqual([0, 0, 0, 0, 1]);
  });

  test("with no active classification draws every point in one colour and shape", () => {
    const style = pointStyle({ ...PLAIN, codes: null });
    expect([...style.colours.slice(3, 6)]).toEqual([0, 0, 0]);
    expect([...style.shapes]).toEqual([0, 0, 0, 0, 0]);
  });

  test("draws the groups selected larger and the others smaller", () => {
    const style = pointStyle({
      ...PLAIN,
      selected: [{ kind: "group", code: code(1) }, { kind: "unassigned" }],
    });
    expect(Array.from(style.sizes, (size) => Number(size.toFixed(2)))).toEqual([
      3.2, 12, 12, 3.2, 3.2,
    ]);
  });

  test("rings the selection and the hover, and draws them large enough to show their colour", () => {
    const style = pointStyle({
      ...PLAIN,
      selected: [{ kind: "group", code: code(1) }],
      selection: new Uint8Array([0b0000_1001]),
      hover: row(2),
    });
    expect([...style.marks]).toEqual([MARK.marked, 0, MARK.marked, MARK.marked, 0]);
    expect(Array.from(style.sizes, (size) => Number(size.toFixed(2)))).toEqual([
      12, 12, 16, 12, 3.2,
    ]);
  });

  test("marks a waiting lasso by its button, over the mark of the selection", () => {
    const lassoed = { rows: new Uint8Array([0b0000_0011]), selection: new Uint8Array([0b10]) };
    const adding = pointStyle({
      ...PLAIN,
      selection: lassoed.selection,
      lasso: { rows: lassoed.rows, mode: "add" },
    });
    expect([...adding.marks]).toEqual([MARK.lassoAdd, MARK.lassoAdd, 0, 0, 0]);
    const removing = pointStyle({ ...PLAIN, lasso: { rows: lassoed.rows, mode: "remove" } });
    expect([...removing.marks]).toEqual([MARK.lassoRemove, MARK.lassoRemove, 0, 0, 0]);
  });

  test("draws a lassoed point of a smaller group at 12, and keeps its lasso's mark under the hover", () => {
    const style = pointStyle({
      ...PLAIN,
      selected: [{ kind: "group", code: code(1) }],
      lasso: { rows: new Uint8Array([0b0000_1001]), mode: "remove" },
      hover: row(3),
    });
    expect([...style.marks]).toEqual([MARK.lassoRemove, 0, 0, MARK.lassoRemove, 0]);
    expect(Array.from(style.sizes, (size) => Number(size.toFixed(2)))).toEqual([
      12, 12, 3.2, 16, 3.2,
    ]);
  });

  test("codes of another length, a set of another table or a group with no colour is a defect", () => {
    expect(() => pointStyle({ ...PLAIN, numRows: 4 })).toThrow(/codes of 5 rows/);
    expect(() => pointStyle({ ...PLAIN, selection: new Uint8Array(2) })).toThrow(/2 bytes/);
    expect(() => pointStyle({ ...PLAIN, groupColours: [ORANGE] })).toThrow(/group 1 of row 1/);
  });
});

describe("rgbOf", () => {
  test("reads #rrggbb as red, green and blue from 0 to 1", () => {
    expect(rgbOf("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(() => rgbOf("orange")).toThrow(/not written as #rrggbb/);
  });
});
