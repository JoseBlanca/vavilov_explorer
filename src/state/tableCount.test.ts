import { describe, expect, test } from "vitest";

import { isRevision } from "./ids.ts";
import type { Revision } from "./ids.ts";
import { countRows } from "./rowSet.ts";
import { tableCountOf, tableCountText } from "./tableCount.ts";

function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
  return value;
}

const SPANISH = new Intl.NumberFormat("es-ES", { useGrouping: "always" });
const count = (value: number): string => SPANISH.format(value);

describe("the count of the table", () => {
  test("is the individuals of the table with no filter", () => {
    expect(
      tableCountText(
        { numShown: 2000, numRows: 2000, filtered: false, numSelected: 0, unreadable: null },
        count,
      ),
    ).toBe("2.000 individuals");
    expect(
      tableCountText(
        { numShown: 1, numRows: 1, filtered: false, numSelected: 0, unreadable: null },
        count,
      ),
    ).toBe("1 individual");
  });

  test("says how many rows a filter shows, even all of them", () => {
    expect(
      tableCountText(
        { numShown: 312, numRows: 2000, filtered: true, numSelected: 0, unreadable: null },
        count,
      ),
    ).toBe("Showing 312 of 2.000 individuals");
    expect(
      tableCountText(
        { numShown: 4, numRows: 4, filtered: true, numSelected: 0, unreadable: null },
        count,
      ),
    ).toBe("Showing 4 of 4 individuals");
  });

  test("says when the number typed for a comparison is no number", () => {
    expect(
      tableCountText(
        { numShown: 2000, numRows: 2000, filtered: false, numSelected: 45, unreadable: "abc" },
        count,
      ),
    ).toBe("2.000 individuals · “abc” is not a number · 45 selected");
  });

  test("adds the rows selected", () => {
    expect(
      tableCountText(
        { numShown: 312, numRows: 2000, filtered: true, numSelected: 45, unreadable: null },
        count,
      ),
    ).toBe("Showing 312 of 2.000 individuals · 45 selected");
  });
});

describe("what the information bar counts", () => {
  test("with a number that cannot be read and no comparison is a defect", () => {
    expect(() =>
      tableCountOf(
        { kind: "open", numRows: 10, loadedAt: revision(1) },
        { at: revision(1), numShown: 10, bits: null, unreadableNumber: true },
        new Uint8Array(2),
        { column: null, condition: { kind: "contains", text: "x" }, showing: "matching" },
      ),
    ).toThrow(/defect/);
  });

  test("holds the text of a comparison that is no number", () => {
    const unread = { at: revision(1), numShown: 10, bits: null, unreadableNumber: true };
    const filter = {
      column: null,
      condition: { kind: "compare", comparison: "less", text: "1.5" },
      showing: "matching",
    } as const;
    expect(
      tableCountOf(
        { kind: "open", numRows: 10, loadedAt: revision(1) },
        unread,
        new Uint8Array(2),
        filter,
      )?.unreadable,
    ).toBe("1.5");
  });

  const open = { kind: "open", numRows: 10, loadedAt: revision(1) } as const;
  const selection = new Uint8Array([0b1001, 0]);

  test("is the rows shown, the table's and the selected", () => {
    expect(
      tableCountOf(
        open,
        { at: revision(1), numShown: 10, bits: null, unreadableNumber: false },
        selection,
        null,
      ),
    ).toEqual({
      numShown: 10,
      numRows: 10,
      filtered: false,
      numSelected: 2,
      unreadable: null,
    });
  });

  test("is filtered when the backend sends the rows shown, even every one", () => {
    const every = new Uint8Array([0xff, 0b11]);
    expect(
      tableCountOf(
        open,
        { at: revision(2), numShown: 10, bits: every, unreadableNumber: false },
        selection,
        null,
      ),
    ).toEqual({
      numShown: 10,
      numRows: 10,
      filtered: true,
      numSelected: 2,
      unreadable: null,
    });
  });

  test("is nothing with no project open", () => {
    expect(tableCountOf({ kind: "noProject" }, null, null, null)).toBeNull();
  });

  test("with a project open and no rows shown or no selection is a defect", () => {
    expect(() => tableCountOf(open, null, selection, null)).toThrow(
      /defect: a count of a table of 10 rows with no rows shown/,
    );
    expect(() =>
      tableCountOf(
        open,
        { at: revision(1), numShown: 10, bits: null, unreadableNumber: false },
        null,
        null,
      ),
    ).toThrow(/defect: a count of a table of 10 rows with no selection/);
  });
});

describe("the number of rows of a set", () => {
  test("is the number of its bits set", () => {
    expect(countRows(new Uint8Array([0b1011, 0b1000_0001]))).toBe(5);
    expect(countRows(new Uint8Array([]))).toBe(0);
  });
});
