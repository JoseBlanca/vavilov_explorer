import { describe, expect, test } from "vitest";

import { tileGrid } from "./tileGrid.ts";

describe("tileGrid", () => {
  test("one tile fills the window, and two or three are stacked", () => {
    expect(tileGrid(1)).toEqual({ columns: 1, rows: 1, panelInGrid: false });
    expect(tileGrid(2)).toEqual({ columns: 1, rows: 2, panelInGrid: false });
    expect(tileGrid(3)).toEqual({ columns: 1, rows: 3, panelInGrid: false });
  });

  test("four make two rows of two", () => {
    expect(tileGrid(4)).toEqual({ columns: 2, rows: 2, panelInGrid: false });
  });

  test("past four, two columns with a row for every two more", () => {
    expect(tileGrid(6)).toEqual({ columns: 2, rows: 3, panelInGrid: false });
    expect(tileGrid(8)).toEqual({ columns: 2, rows: 4, panelInGrid: false });
    expect(tileGrid(10)).toEqual({ columns: 2, rows: 5, panelInGrid: false });
  });

  test("an odd number past four leaves a place the groups panel takes", () => {
    expect(tileGrid(5)).toEqual({ columns: 2, rows: 3, panelInGrid: true });
    expect(tileGrid(7)).toEqual({ columns: 2, rows: 4, panelInGrid: true });
  });

  test("no tile is one empty place", () => {
    expect(tileGrid(0)).toEqual({ columns: 1, rows: 1, panelInGrid: false });
  });
});
