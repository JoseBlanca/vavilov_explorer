import { describe, expect, test } from "vitest";

import { pagesOf, rowsInView, rowsOfPage } from "./tablePages.ts";

describe("the rows in view", () => {
  test("are those under the viewport and the margin on each side", () => {
    // Rows of 28 px; a scroll of 2,800 px is row 100, and 560 px show rows
    // 100 to 119; a scroll of 14 px more shows a part of row 120.
    expect(rowsInView(2800, 560, 28, 2000, 10)).toEqual({ first: 90, end: 130 });
    expect(rowsInView(2814, 560, 28, 2000, 10)).toEqual({ first: 90, end: 131 });
  });

  test("stay within the table at its top and its end", () => {
    expect(rowsInView(0, 560, 28, 2000, 10)).toEqual({ first: 0, end: 30 });
    expect(rowsInView(55_440, 560, 28, 2000, 10)).toEqual({ first: 1970, end: 2000 });
    expect(rowsInView(0, 560, 28, 5, 10)).toEqual({ first: 0, end: 5 });
    expect(rowsInView(0, 560, 28, 0, 10)).toEqual({ first: 0, end: 0 });
  });

  test("of a viewport not yet measured are none", () => {
    expect(rowsInView(0, 560, 0, 2000, 10)).toEqual({ first: 0, end: 0 });
  });
});

describe("the pages of the table", () => {
  test("of a range are every page it touches", () => {
    expect(pagesOf({ first: 90, end: 131 })).toEqual([0, 1]);
    expect(pagesOf({ first: 100, end: 200 })).toEqual([1]);
    expect(pagesOf({ first: 0, end: 0 })).toEqual([]);
  });

  test("the last page has the rows that are left", () => {
    expect(rowsOfPage(1, 2000)).toEqual({ first: 100, end: 200 });
    expect(rowsOfPage(19, 1950)).toEqual({ first: 1900, end: 1950 });
  });
});
