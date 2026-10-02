// Which rows of the table are on screen, and the pages they are fetched in
// (.claude/skills/coding/frontend.md, "The table").

import type { ColumnId, Revision } from "./ids.ts";
import type { RowPage } from "./rowPage.ts";

/** The rows of a page, the unit the table fetches from the backend. */
export const PAGE_ROWS = 100;

/** Rows from `first` to before `end`. */
export interface RowRange {
  /** The first row. */
  readonly first: number;
  /** The row after the last, `first` for no row. */
  readonly end: number;
}

/**
 * The rows to draw: those under the viewport of a scroll at `scrollTop`,
 * and `margin` rows more on each side, within the table.
 */
export function rowsInView(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  numRows: number,
  margin: number,
): RowRange {
  if (rowHeight <= 0) {
    return { first: 0, end: 0 };
  }
  const top = Math.floor(scrollTop / rowHeight);
  const bottom = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const first = Math.min(numRows, Math.max(0, top - margin));
  return { first, end: Math.max(first, Math.min(numRows, bottom + margin)) };
}

/** The pages that hold the rows of `range`, in order. */
export function pagesOf(range: RowRange): number[] {
  if (range.end <= range.first) {
    return [];
  }
  const pages: number[] = [];
  for (let page = Math.floor(range.first / PAGE_ROWS); page * PAGE_ROWS < range.end; page += 1) {
    pages.push(page);
  }
  return pages;
}

/** The rows of page `page` of a table of `numRows`. */
export function rowsOfPage(page: number, numRows: number): RowRange {
  const first = page * PAGE_ROWS;
  return { first, end: Math.min(numRows, first + PAGE_ROWS) };
}

/**
 * How a page of rows stands against the window's copy: `current` when it is
 * of the table loaded at `loadedAt`, holds the columns `wanted` in their
 * order, and each at the revision the copy has; `ahead` when one of them
 * changed after the copy and none before, so that the message of the change
 * is on its way and will make it current; `behind` otherwise, a page to
 * fetch again.
 */
export function pageStanding(
  page: RowPage,
  loadedAt: Revision,
  wanted: readonly ColumnId[],
  columnRevision: (column: ColumnId) => Revision | null,
): PageStanding {
  if (
    page.loadedAt !== loadedAt ||
    page.columns.length !== wanted.length ||
    page.columns.some((column, index) => column.id !== wanted[index])
  ) {
    return "behind";
  }
  let ahead = false;
  for (const column of page.columns) {
    const copy = columnRevision(column.id);
    if (copy === null || column.revision < copy) {
      return "behind";
    }
    ahead ||= column.revision > copy;
  }
  return ahead ? "ahead" : "current";
}

/** How a page of rows stands against the window's copy, as {@link pageStanding} says. */
export type PageStanding = "current" | "ahead" | "behind";
