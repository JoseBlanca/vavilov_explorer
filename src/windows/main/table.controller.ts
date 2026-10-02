import { nothing, render } from "lit-html";

import type { Answer, Connection } from "../../backend/connection.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow, TableDescription } from "../../state/description.ts";
import { isRowIndex } from "../../state/ids.ts";
import type { Revision, RowIndex } from "../../state/ids.ts";
import type { RowPage } from "../../state/rowPage.ts";
import { rangeBits } from "../../state/rowSet.ts";
import { PAGE_ROWS, pagesOf, rowsInView, rowsOfPage } from "../../state/tablePages.ts";
import { fetchedColumns, tableColumns, tableRow } from "../../state/tableRows.ts";
import type { TableRow } from "../../state/tableRows.ts";
import { decimalMark } from "../shared/numbers.ts";
import { tableView } from "./table.view.ts";

/** The table in its element. */
export interface Table {
  /** Draws the table again, when the description of the table has changed. */
  readonly redraw: () => void;
  /** Unsubscribes, stops watching the size and empties the element. */
  readonly destroy: () => void;
}

/** Rows drawn above and below those on screen, so that a scroll shows no gap. */
const MARGIN_ROWS = 30;
/** Pages kept beyond those the rows drawn need, so that scrolling back does not fetch them again. */
const PAGES_KEPT = 3;

/**
 * The table of the main window: it draws the rows on screen, fetches their
 * pages from the backend, and turns a click on a row into the selection
 * (docs/design.md, section 2.1). It keeps the pages it fetched, the scroll and
 * the row of the last click, the anchor of a shift-click; everything else is
 * the window's copy of the state.
 */
export function createTable(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  report: (error: unknown) => void,
): Table {
  const { state } = connection;
  const mark = decimalMark();
  const pages = new Map<number, RowPage>();
  const fetching = new Set<number>();
  let loadedAt: Revision | null = null;
  let anchor: RowIndex | null = null;
  let frame: number | null = null;

  const part = (name: string): HTMLElement | null => {
    const found = element.querySelector(`[data-${name}]`);
    return found instanceof HTMLElement ? found : null;
  };

  const schedule = (): void => {
    frame ??= requestAnimationFrame(() => {
      frame = null;
      draw();
    });
  };

  /** Whether a page still holds what the copy and the description hold. */
  const isCurrent = (page: RowPage, table: TableDescription): boolean => {
    const wanted = fetchedColumns(table);
    return (
      page.loadedAt === table.loadedAt &&
      page.columns.length === wanted.length &&
      page.columns.every((column, index) => {
        const revision = state.columnRevision(column.id);
        return column.id === wanted[index] && revision !== null && column.revision >= revision;
      })
    );
  };

  const fetchPage = (index: number, table: TableDescription): void => {
    const { first, end } = rowsOfPage(index, table.numRows);
    fetching.add(index);
    connection
      .fetchRows(rowIndex(first), end - first, fetchedColumns(table))
      .then((answer) => {
        fetching.delete(index);
        if (!answer.ok) {
          throw defect(
            `the rows ${String(first)} to ${String(end)} were refused: ${answer.error.kind}`,
          );
        }
        // A page of a table since replaced is dropped; the load draws again.
        if (answer.value !== "stale" && answer.value.loadedAt === loadedAt) {
          pages.set(index, answer.value);
          schedule();
        }
      })
      .catch((error: unknown) => {
        fetching.delete(index);
        report(error);
      });
  };

  const select = (row: RowIndex, extend: boolean): void => {
    const project = state.project();
    if (project.kind !== "open") {
      return;
    }
    const from = extend && anchor !== null ? anchor : row;
    if (!extend) {
      anchor = row;
    }
    connection
      .setSelection(rangeBits(project.numRows, from, row))
      .then(answered("selecting rows"), report);
  };

  const draw = (): void => {
    const now = description();
    if (now.kind === "none") {
      pages.clear();
      loadedAt = null;
      render(nothing, element);
      return;
    }
    if (now.kind === "behind") {
      // The description of the copy's shape is on its way, and draws again.
      return;
    }
    const table = now.description;
    if (table.loadedAt !== loadedAt) {
      pages.clear();
      loadedAt = table.loadedAt;
      anchor = null;
      part("scroller")?.scrollTo({ top: 0 });
    }
    for (const [index, page] of pages) {
      if (!isCurrent(page, table)) {
        pages.delete(index);
      }
    }
    const scroller = part("scroller");
    const rowHeight = part("probe")?.offsetHeight ?? 0;
    const range = rowsInView(
      scroller?.scrollTop ?? 0,
      scroller?.clientHeight ?? 0,
      rowHeight,
      table.numRows,
      MARGIN_ROWS,
    );
    const rows: TableRow[] = [];
    for (let row = range.first; row < range.end; row += 1) {
      const page = pages.get(Math.floor(row / PAGE_ROWS)) ?? null;
      rows.push(tableRow(table, page, rowIndex(row), state.codes, state.selection(), mark));
    }
    render(
      tableView({
        columns: tableColumns(table),
        numRows: table.numRows,
        range,
        rows,
        onRowClick: select,
        onRole: (column, role) => {
          connection.setRole(column, role).then(answered("changing the role of a column"), report);
        },
        onScroll: schedule,
      }),
      element,
    );
    // The first draw has nothing to measure yet: draw again once it has.
    if (rowHeight === 0 && table.numRows > 0) {
      schedule();
      return;
    }
    const needed = pagesOf(range);
    for (const index of needed) {
      if (!pages.has(index) && !fetching.has(index)) {
        fetchPage(index, table);
      }
    }
    const [low = 0, high = 0] = [needed[0], needed.at(-1)];
    for (const index of pages.keys()) {
      if (index < low - PAGES_KEPT || index > high + PAGES_KEPT) {
        pages.delete(index);
      }
    }
  };

  const resized = new ResizeObserver(schedule);
  resized.observe(element);
  const unsubscribes = (["table", "codes", "selection"] as const).map((aspect) =>
    state.subscribe(aspect, draw),
  );
  draw();
  return {
    redraw: draw,
    destroy: () => {
      resized.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      render(nothing, element);
    },
  };
}

function rowIndex(row: number): RowIndex {
  if (!isRowIndex(row)) {
    throw defect(`a row ${String(row)} of the table`);
  }
  return row;
}

const answered =
  (what: string) =>
  (answer: Answer): void => {
    if (!answer.ok) {
      console.warn(`Vavilov Explorer: ${what} was refused`, answer.error);
    }
  };
