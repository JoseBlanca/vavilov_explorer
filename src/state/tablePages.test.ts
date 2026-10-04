import { describe, expect, test } from "vitest";

import type { Refusal } from "./commandError.ts";
import type { Shown } from "./filter.ts";
import { isColumnId, isPosition, isRevision, isRowIndex } from "./ids.ts";
import type { ColumnId, Position, Revision } from "./ids.ts";
import type { RowPage } from "./rowPage.ts";
import {
  checkPageRefusal,
  pageStanding,
  pagesOf,
  positionsIn,
  rowsInView,
  rowsOfPage,
} from "./tablePages.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}
function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
  return value;
}
function position(value: number): Position {
  if (!isPosition(value)) throw new Error("not a position");
  return value;
}

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
    expect(pagesOf({ first: position(90), end: position(131) })).toEqual([0, 1]);
    expect(pagesOf({ first: position(100), end: position(200) })).toEqual([1]);
    expect(pagesOf({ first: position(0), end: position(0) })).toEqual([]);
  });

  test("the last page has the rows that are left", () => {
    expect(rowsOfPage(1, 2000)).toEqual({ first: 100, end: 200 });
    expect(rowsOfPage(19, 1950)).toEqual({ first: 1900, end: 1950 });
  });

  test("of a range are the positions in it, in order", () => {
    expect(positionsIn({ first: position(98), end: position(101) })).toEqual([98, 99, 100]);
    expect(positionsIn({ first: position(5), end: position(5) })).toEqual([]);
  });
});

describe("a page of rows against the window's copy", () => {
  // A page of the table loaded at 2, of the rows shown since 3, read at 6,
  // with the names (0) at 2, height (1) at 4 and note (5) at 6: its first
  // row, at position 0, of one row shown.
  const page = (
    columns: readonly [number, number][],
    loadedAt = 2,
    shownAt = 3,
    first = 0,
    count = 1,
    namesAt = 2,
  ): RowPage => ({
    revision: revision(6),
    loadedAt: revision(loadedAt),
    shownAt: revision(shownAt),
    namesAt: revision(namesAt),
    first: position(first),
    count,
    rows: Array.from({ length: count }, (_, index) => {
      const row = first + index;
      if (!isRowIndex(row)) throw new Error("not a row");
      return row;
    }),
    names: Array.from({ length: count }, (_, index) => `p${String(first + index + 1)}`),
    columns: columns.map(([id, at]) => ({
      id: column(id),
      revision: revision(at),
      type: "float",
      values: Array.from({ length: count }, () => 1.5),
    })),
  });
  /** The copy's rows shown: `numShown` of them since `at`, every row. */
  const shown = (at: number, numShown = 1): Shown => ({
    at: revision(at),
    numShown,
    bits: null,
    unreadableNumber: false,
  });
  const wanted = [column(1), column(5)];
  const columns: [number, number][] = [
    [1, 4],
    [5, 6],
  ];
  /** The copy's revisions of the columns: the names at `namesAt`, height at 4, note at `noteAt`. */
  const copy =
    (noteAt: number, namesAt = 2) =>
    (id: ColumnId): Revision | null =>
      id === column(0)
        ? revision(namesAt)
        : id === column(1)
          ? revision(4)
          : id === column(5)
            ? revision(noteAt)
            : null;
  const NAMES = column(0);

  test("is current when each column is at the copy's revision", () => {
    expect(pageStanding(page(columns), 0, revision(2), shown(3), wanted, copy(6), NAMES)).toBe(
      "current",
    );
  });

  test("is ahead when a column changed after the copy and none before", () => {
    // note was made a category at 6, and the copy has not heard yet.
    expect(pageStanding(page(columns), 0, revision(2), shown(3), wanted, copy(3), NAMES)).toBe(
      "ahead",
    );
  });

  test("is behind when a column changed after it was read", () => {
    expect(pageStanding(page(columns), 0, revision(2), shown(3), wanted, copy(7), NAMES)).toBe(
      "behind",
    );
    // Behind for one column and ahead for another: fetched again.
    expect(
      pageStanding(
        page([
          [1, 3],
          [5, 6],
        ]),
        0,
        revision(2),
        shown(3),
        wanted,
        copy(3),
        NAMES,
      ),
    ).toBe("behind");
  });

  test("is behind when it is of rows shown before, and ahead of rows shown after the copy's", () => {
    expect(
      pageStanding(page(columns, 2, 3), 0, revision(2), shown(5), wanted, copy(6), NAMES),
    ).toBe("behind");
    expect(
      pageStanding(page(columns, 2, 5), 0, revision(2), shown(3), wanted, copy(6), NAMES),
    ).toBe("ahead");
  });

  test("is behind when it was fetched for another number of rows shown", () => {
    // Page 1 fetched while 150 rows were shown, positions 100 to 149, and
    // read once the rows shown were 120, since 5: the copy has those too,
    // and its page 1 is positions 100 to 119.
    const fetched = page(columns, 2, 5, 100, 50);
    expect(pageStanding(fetched, 1, revision(2), shown(5, 120), wanted, copy(6), NAMES)).toBe(
      "behind",
    );
    expect(pageStanding(fetched, 1, revision(2), shown(5, 150), wanted, copy(6), NAMES)).toBe(
      "current",
    );
    // Not the page of its index.
    expect(pageStanding(fetched, 2, revision(2), shown(5, 150), wanted, copy(6), NAMES)).toBe(
      "behind",
    );
    // Of rows shown after the copy's, it waits for their message.
    expect(pageStanding(fetched, 1, revision(2), shown(3, 150), wanted, copy(6), NAMES)).toBe(
      "ahead",
    );
  });

  test("is behind when the names changed after it was read, and ahead when after the copy", () => {
    // An ID edited at 7, after the page was read.
    expect(pageStanding(page(columns), 0, revision(2), shown(3), wanted, copy(6, 7), NAMES)).toBe(
      "behind",
    );
    // An ID edited at 5, which the copy has not heard of yet.
    const edited = page(columns, 2, 3, 0, 1, 5);
    expect(pageStanding(edited, 0, revision(2), shown(3), wanted, copy(6), NAMES)).toBe("ahead");
    expect(pageStanding(edited, 0, revision(2), shown(3), wanted, copy(6, 5), NAMES)).toBe(
      "current",
    );
  });

  test("is behind when it is of another table, or of other columns", () => {
    expect(pageStanding(page(columns, 1), 0, revision(2), shown(3), wanted, copy(6), NAMES)).toBe(
      "behind",
    );
    expect(
      pageStanding(
        page([
          [5, 6],
          [1, 4],
        ]),
        0,
        revision(2),
        shown(3),
        wanted,
        copy(6),
        NAMES,
      ),
    ).toBe("behind");
    expect(pageStanding(page([[1, 4]]), 0, revision(2), shown(3), wanted, copy(6), NAMES)).toBe(
      "behind",
    );
    expect(
      pageStanding(
        page([
          [1, 4],
          [7, 6],
        ]),
        0,
        revision(2),
        shown(3),
        [column(1), column(7)],
        copy(6),
        NAMES,
      ),
    ).toBe("behind");
  });
});

describe("a page the backend refused", () => {
  const outOfRange = (numShown: number): Refusal => ({
    kind: "rowsOutOfRange",
    first: position(100),
    count: 50,
    numShown,
  });

  test("past fewer rows shown than when it was asked for is fetched again", () => {
    expect(() => {
      checkPageRefusal(outOfRange(120), 150);
    }).not.toThrow();
  });

  test("past the rows shown it was asked for is a defect", () => {
    expect(() => {
      checkPageRefusal(outOfRange(150), 150);
    }).toThrow(/defect: 50 rows from position 100 refused past the 150 rows shown/);
  });

  test("for another reason is a defect", () => {
    expect(() => {
      checkPageRefusal({ kind: "unknownColumn", column: column(7) }, 150);
    }).toThrow(/defect: a page of rows refused as unknownColumn/);
  });
});
