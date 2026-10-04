import { describe, expect, test } from "vitest";

import { decodeWidgetList, isWidgetsMessage } from "./decodeWidgets.ts";

// The bytes below are those the app layer writes, in the tests of
// src-tauri/src/widgets/tests.rs.

function buffer(bytes: readonly number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

// TWO_HISTOGRAMS: at sequence 1, the histograms 1 of height and 2 of seeds.
// prettier-ignore
const TWO_HISTOGRAMS = [
  6, 0, 0, 0, 0, 0, 0, 0, // a list of widgets
  1, 0, 0, 0, 0, 0, 0, 0, // sequence 1
  2, 0, 0, 0, 0, 0, 0, 0, // two widgets
  1, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 255, 255, 255, 255, // 1, a histogram of height
  255, 255, 255, 255, 0, 0, 0, 0,
  2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 255, 255, 255, 255, // 2, a histogram of seeds
  255, 255, 255, 255, 0, 0, 0, 0,
];

// TWO_MAPS: at sequence 1, the map 1 of height and seeds and the map of
// countries 2 of column 2.
// prettier-ignore
const TWO_MAPS = [
  6, 0, 0, 0, 0, 0, 0, 0, // a list of widgets
  1, 0, 0, 0, 0, 0, 0, 0, // sequence 1
  2, 0, 0, 0, 0, 0, 0, 0, // two widgets
  1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, // 1, a map of height and seeds
  255, 255, 255, 255, 0, 0, 0, 0,
  2, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 255, 255, 255, 255, // 2, a map of countries
  255, 255, 255, 255, 0, 0, 0, 0,
];

const NONE = 0xffff_ffff;

/** A list at sequence 3 of one widget, 7, of the kind `kind` and the columns `columns`. */
function one(kind: number, columns: readonly number[]): number[] {
  const u32 = (value: number): number[] => [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
  return [
    ...[6, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    ...[7, 0, 0, 0, kind, 0, 0, 0],
    ...columns.flatMap(u32),
    ...[0, 0, 0, 0],
  ];
}

describe("a list of widgets", () => {
  test("is told by its first byte", () => {
    expect(isWidgetsMessage(buffer(TWO_HISTOGRAMS))).toBe(true);
    expect(isWidgetsMessage(buffer([4, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  test("decodes to its sequence number and its widgets, in their order", () => {
    expect(decodeWidgetList(buffer(TWO_HISTOGRAMS))).toEqual({
      seq: 1,
      widgets: [
        { id: 1, spec: { kind: "histogram", column: 1 } },
        { id: 2, spec: { kind: "histogram", column: 4 } },
      ],
    });
  });

  test("the two maps decode to their kinds and their columns", () => {
    expect(decodeWidgetList(buffer(TWO_MAPS)).widgets).toEqual([
      { id: 1, spec: { kind: "map", latitude: 1, longitude: 4 } },
      { id: 2, spec: { kind: "countryMap", country: 2 } },
    ]);
  });

  test("each kind of widget gives its columns", () => {
    expect(decodeWidgetList(buffer(one(1, [4, 5, 4]))).widgets).toEqual([
      { id: 7, spec: { kind: "scatter3d", axes: [4, 5, 4] } },
    ]);
    expect(decodeWidgetList(buffer(one(2, [2, 3, NONE]))).widgets).toEqual([
      { id: 7, spec: { kind: "map", latitude: 2, longitude: 3 } },
    ]);
    expect(decodeWidgetList(buffer(one(3, [6, NONE, NONE]))).widgets).toEqual([
      { id: 7, spec: { kind: "countryMap", country: 6 } },
    ]);
  });

  test("an unknown kind, a column missing or one too many is a defect", () => {
    expect(() => decodeWidgetList(buffer(one(5, [1, NONE, NONE])))).toThrow(/kind of widget 5/);
    expect(() => decodeWidgetList(buffer(one(1, [1, 2, NONE])))).toThrow(/column/);
    expect(() => decodeWidgetList(buffer(one(4, [1, 2, NONE])))).toThrow(/histogram/);
  });

  test("a length that does not fit its count, or a byte that should be zero, is a defect", () => {
    expect(() => decodeWidgetList(buffer(TWO_HISTOGRAMS.slice(0, -8)))).toThrow(/2 widgets/);
    const stray = [...TWO_HISTOGRAMS];
    stray[3] = 1;
    expect(() => decodeWidgetList(buffer(stray))).toThrow(/should be zero/);
  });

  test("a widget numbered 0, a number the app layer never gives, is a defect", () => {
    const zero = [...TWO_HISTOGRAMS];
    zero[24] = 0;
    expect(() => decodeWidgetList(buffer(zero))).toThrow(/widget/);
  });
});
