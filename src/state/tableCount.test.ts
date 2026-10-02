import { describe, expect, test } from "vitest";

import { countRows } from "./rowSet.ts";
import { tableCountText } from "./tableCount.ts";

const SPANISH = new Intl.NumberFormat("es-ES", { useGrouping: "always" });
const count = (value: number): string => SPANISH.format(value);

describe("the count of the table", () => {
  test("is the individuals of the table with no filter", () => {
    expect(
      tableCountText({ numShown: 2000, numRows: 2000, filtered: false, numSelected: 0 }, count),
    ).toBe("2.000 individuals");
    expect(
      tableCountText({ numShown: 1, numRows: 1, filtered: false, numSelected: 0 }, count),
    ).toBe("1 individual");
  });

  test("says how many rows a filter shows, even all of them", () => {
    expect(
      tableCountText({ numShown: 312, numRows: 2000, filtered: true, numSelected: 0 }, count),
    ).toBe("Showing 312 of 2.000 individuals");
    expect(tableCountText({ numShown: 4, numRows: 4, filtered: true, numSelected: 0 }, count)).toBe(
      "Showing 4 of 4 individuals",
    );
  });

  test("adds the rows selected", () => {
    expect(
      tableCountText({ numShown: 312, numRows: 2000, filtered: true, numSelected: 45 }, count),
    ).toBe("Showing 312 of 2.000 individuals · 45 selected");
  });
});

describe("the number of rows of a set", () => {
  test("is the number of its bits set", () => {
    expect(countRows(new Uint8Array([0b1011, 0b1000_0001]))).toBe(5);
    expect(countRows(new Uint8Array([]))).toBe(0);
  });
});
