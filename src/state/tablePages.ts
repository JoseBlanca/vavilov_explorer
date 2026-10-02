// Which rows of the table are on screen, and the pages they are fetched in
// (.claude/skills/coding/frontend.md, "The table"). A row on screen is
// counted by its position among the rows the filter shows, not by its row
// of the table.

import type { Refusal } from "./commandError.ts";
import { defect } from "./defect.ts";
import type { Shown } from "./filter.ts";
import { isPosition } from "./ids.ts";
import type { ColumnId, Position, Revision } from "./ids.ts";
import type { RowPage } from "./rowPage.ts";

/** The rows of a page, the unit the table fetches from the backend. */
export const PAGE_ROWS = 100;

/** The rows shown from position `first` to before position `end`. */
export interface RowRange {
  /** The position of the first row. */
  readonly first: Position;
  /** The position after the last row, `first` for no row. */
  readonly end: Position;
}

/** `value` as a position, which the arithmetic below keeps within a `u32`. */
function positionOf(value: number): Position {
  if (!isPosition(value)) {
    throw defect(`a position ${String(value)} among the rows shown`);
  }
  return value;
}

/** No row: the rows to draw before the table is measured. */
export const NO_ROWS: RowRange = { first: positionOf(0), end: positionOf(0) };

/**
 * The rows to draw: those under the viewport of a scroll at `scrollTop`,
 * and `margin` rows more on each side, within the `numShown` rows shown.
 */
export function rowsInView(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  numShown: number,
  margin: number,
): RowRange {
  if (rowHeight <= 0) {
    return NO_ROWS;
  }
  const top = Math.floor(scrollTop / rowHeight);
  const bottom = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const first = Math.min(numShown, Math.max(0, top - margin));
  return {
    first: positionOf(first),
    end: positionOf(Math.max(first, Math.min(numShown, bottom + margin))),
  };
}

/** The positions of `range`, in order. */
export function positionsIn(range: RowRange): Position[] {
  const positions: Position[] = [];
  for (let at: number = range.first; at < range.end; at += 1) {
    positions.push(positionOf(at));
  }
  return positions;
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

/** The rows of page `page` when `numShown` rows are shown. */
export function rowsOfPage(page: number, numShown: number): RowRange {
  const first = page * PAGE_ROWS;
  return { first: positionOf(first), end: positionOf(Math.min(numShown, first + PAGE_ROWS)) };
}

/**
 * How page `index` stands against the window's copy: `current` when it is
 * of the table loaded at `loadedAt` and of the rows `shown` the copy has,
 * holds the rows of its index among them and the columns `wanted` in their
 * order, and each column at the revision the copy has; `ahead` when the
 * rows shown or one of the columns changed after the copy and none before,
 * so that the message of the change is on its way and will make it current,
 * or not; `behind` otherwise, a page to fetch again. A page asked for while
 * another number of rows was shown, and read once the copy's were, holds
 * the rows of another page, or past the copy's last row.
 */
export function pageStanding(
  page: RowPage,
  index: number,
  loadedAt: Revision,
  shown: Shown,
  wanted: readonly ColumnId[],
  columnRevision: (column: ColumnId) => Revision | null,
): PageStanding {
  if (
    page.loadedAt !== loadedAt ||
    page.shownAt < shown.at ||
    page.columns.length !== wanted.length ||
    page.columns.some((column, position) => column.id !== wanted[position])
  ) {
    return "behind";
  }
  let ahead = page.shownAt > shown.at;
  // A page of rows shown after the copy's is measured against them once
  // their message makes it current.
  if (!ahead) {
    const rows = rowsOfPage(index, shown.numShown);
    if (page.first !== rows.first || page.count !== rows.end - rows.first) {
      return "behind";
    }
  }
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

/**
 * Checks the refusal of a page asked for while `numShown` rows were shown.
 * A page past the rows shown is refused when fewer rows are shown by the
 * time the backend reads the request, and the table then fetches the pages
 * of the rows shown now.
 *
 * @throws A defect for any other refusal, and for a page past the very
 * rows it was asked for: the window asks only for pages within them.
 */
export function checkPageRefusal(error: Refusal, numShown: number): void {
  if (error.kind !== "rowsOutOfRange") {
    throw defect(`a page of rows refused as ${error.kind}`);
  }
  if (error.numShown === numShown) {
    throw defect(
      `${String(error.count)} rows from position ${String(error.first)} refused past the ${String(numShown)} rows shown, as many as when they were asked for`,
    );
  }
}
