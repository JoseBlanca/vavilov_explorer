import { describe, expect, test } from "vitest";

import { isColumnId, isRevision, isRowIndex } from "./ids.ts";
import type { ColumnId, Revision } from "./ids.ts";
import type { RowPage } from "./rowPage.ts";
import { pageStanding, pagesOf, rowsInView, rowsOfPage } from "./tablePages.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}
function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
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
    expect(pagesOf({ first: 90, end: 131 })).toEqual([0, 1]);
    expect(pagesOf({ first: 100, end: 200 })).toEqual([1]);
    expect(pagesOf({ first: 0, end: 0 })).toEqual([]);
  });

  test("the last page has the rows that are left", () => {
    expect(rowsOfPage(1, 2000)).toEqual({ first: 100, end: 200 });
    expect(rowsOfPage(19, 1950)).toEqual({ first: 1900, end: 1950 });
  });
});

describe("a page of rows against the window's copy", () => {
  // A page of the table loaded at 2, of the rows shown since 3, read at 6,
  // with height (1) at 4 and note (5) at 6.
  const page = (columns: readonly [number, number][], loadedAt = 2, shownAt = 3): RowPage => {
    const row = 0;
    if (!isRowIndex(row)) throw new Error("not a row");
    return {
      revision: revision(6),
      loadedAt: revision(loadedAt),
      shownAt: revision(shownAt),
      first: 0,
      count: 1,
      rows: [row],
      names: ["p1"],
      columns: columns.map(([id, at]) => ({
        id: column(id),
        revision: revision(at),
        type: "float",
        values: [1.5],
      })),
    };
  };
  const wanted = [column(1), column(5)];
  /** The copy's revisions of the columns: height at 4, note at `noteAt`. */
  const copy =
    (noteAt: number) =>
    (id: ColumnId): Revision | null =>
      id === column(1) ? revision(4) : id === column(5) ? revision(noteAt) : null;

  test("is current when each column is at the copy's revision", () => {
    expect(
      pageStanding(
        page([
          [1, 4],
          [5, 6],
        ]),
        revision(2),
        revision(3),
        wanted,
        copy(6),
      ),
    ).toBe("current");
  });

  test("is ahead when a column changed after the copy and none before", () => {
    // note was made a category at 6, and the copy has not heard yet.
    expect(
      pageStanding(
        page([
          [1, 4],
          [5, 6],
        ]),
        revision(2),
        revision(3),
        wanted,
        copy(3),
      ),
    ).toBe("ahead");
  });

  test("is behind when a column changed after it was read", () => {
    expect(
      pageStanding(
        page([
          [1, 4],
          [5, 6],
        ]),
        revision(2),
        revision(3),
        wanted,
        copy(7),
      ),
    ).toBe("behind");
    // Behind for one column and ahead for another: fetched again.
    expect(
      pageStanding(
        page([
          [1, 3],
          [5, 6],
        ]),
        revision(2),
        revision(3),
        wanted,
        copy(3),
      ),
    ).toBe("behind");
  });

  test("is behind when it is of rows shown before, and ahead of rows shown after the copy's", () => {
    const columns: [number, number][] = [
      [1, 4],
      [5, 6],
    ];
    expect(pageStanding(page(columns, 2, 3), revision(2), revision(5), wanted, copy(6))).toBe(
      "behind",
    );
    expect(pageStanding(page(columns, 2, 5), revision(2), revision(3), wanted, copy(6))).toBe(
      "ahead",
    );
  });

  test("is behind when it is of another table, or of other columns", () => {
    expect(
      pageStanding(
        page(
          [
            [1, 4],
            [5, 6],
          ],
          1,
        ),
        revision(2),
        revision(3),
        wanted,
        copy(6),
      ),
    ).toBe("behind");
    expect(
      pageStanding(
        page([
          [5, 6],
          [1, 4],
        ]),
        revision(2),
        revision(3),
        wanted,
        copy(6),
      ),
    ).toBe("behind");
    expect(pageStanding(page([[1, 4]]), revision(2), revision(3), wanted, copy(6))).toBe("behind");
    expect(
      pageStanding(
        page([
          [1, 4],
          [7, 6],
        ]),
        revision(2),
        revision(3),
        [column(1), column(7)],
        copy(6),
      ),
    ).toBe("behind");
  });
});
