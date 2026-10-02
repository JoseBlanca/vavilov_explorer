import { nothing, render } from "lit-html";

import type { Connection } from "../../backend/connection.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow, Role, TableDescription } from "../../state/description.ts";
import { rowAt, shownRowsOf } from "../../state/filter.ts";
import type { ColumnId, Revision, RowIndex } from "../../state/ids.ts";
import type { Question } from "../../state/question.ts";
import { roleChangeQuestion } from "../../state/roles.ts";
import type { RowPage } from "../../state/rowPage.ts";
import { intersection, rangeBits } from "../../state/rowSet.ts";
import {
  PAGE_ROWS,
  pageStanding,
  pagesOf,
  rowsInView,
  rowsOfPage,
} from "../../state/tablePages.ts";
import { fetchedColumns, tableColumns, tableRow } from "../../state/tableRows.ts";
import type { TableRow } from "../../state/tableRows.ts";
import { answered } from "../shared/answered.ts";
import { tableView } from "./table.view.ts";

/** The table in its element. */
export interface Table {
  /** Draws the table again, when the description of the table has changed. */
  readonly redraw: () => void;
  /** Gives the focus to the table, when it shows one. */
  readonly focus: () => void;
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
 * the window's copy of the state. A change of role that would stop the
 * active classification is put to the user with `ask` first, and the
 * question is withdrawn when another table is loaded meanwhile. When
 * another table takes the place of the one drawn, the focus goes to its
 * grid from a control of the table it replaced, or from nowhere.
 */
export function createTable(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  mark: string,
  ask: (question: Question, withdrawn: AbortSignal) => Promise<boolean>,
  report: (error: unknown) => void,
): Table {
  const { state } = connection;
  const pages = new Map<number, RowPage>();
  /** The fetch of each page on its way, by a token of its own. */
  const fetching = new Map<number, object>();
  let loadedAt: Revision | null = null;
  let anchor: RowIndex | null = null;
  let frame: number | null = null;
  let destroyed = false;
  /** The question about a role being asked, and the load of the table it is about. */
  let asking: { readonly loadedAt: Revision; readonly withdraw: AbortController } | null = null;
  /**
   * The row at each position among those shown, for the rows shown since
   * `at`, worked out once for each change of the rows shown.
   */
  let positions: { readonly at: Revision; readonly rows: Uint32Array | null } | null = null;

  /** The rows shown now, their number, and the row at each position. */
  const shownNow = (
    table: TableDescription,
  ): { at: Revision; numShown: number; rows: Uint32Array | null; bits: Uint8Array | null } => {
    const shown = state.shown();
    if (shown === null) {
      throw defect("a table drawn with no rows shown in the copy");
    }
    if (positions?.at !== shown.at) {
      positions = { at: shown.at, rows: shownRowsOf(shown) };
    }
    if (shown.bits === null && shown.numShown !== table.numRows) {
      throw defect(
        `every row shown, ${String(shown.numShown)}, of a table of ${String(table.numRows)} rows`,
      );
    }
    return { at: shown.at, numShown: shown.numShown, rows: positions.rows, bits: shown.bits };
  };

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

  /** How a page stands against the copy and the description. */
  const standing = (
    page: RowPage,
    table: TableDescription,
    shownAt: Revision,
  ): ReturnType<typeof pageStanding> =>
    pageStanding(page, table.loadedAt, shownAt, fetchedColumns(table), state.columnRevision);

  const fetchPage = (index: number, table: TableDescription, numShown: number): void => {
    const { first, end } = rowsOfPage(index, numShown);
    const token = {};
    fetching.set(index, token);
    const settle = (): boolean => {
      // A fetch made for a table since replaced has a newer one in its place.
      if (fetching.get(index) !== token) {
        return false;
      }
      fetching.delete(index);
      return !destroyed;
    };
    connection
      .fetchRows(first, end - first, fetchedColumns(table))
      .then((answer) => {
        if (!settle()) {
          return;
        }
        if (!answer.ok) {
          // The rows shown changed after the fetch, and the page asked
          // for is past them: the draw fetches the pages of those shown now.
          if (answer.error.kind === "rowsOutOfRange") {
            schedule();
            return;
          }
          throw defect(
            `the rows ${String(first)} to ${String(end)} were refused: ${answer.error.kind}`,
          );
        }
        // A page of a table since replaced is dropped, and the draw fetches
        // the page of the table there is now.
        if (answer.value !== "stale" && answer.value.loadedAt === loadedAt) {
          pages.set(index, answer.value);
        }
        schedule();
      })
      .catch((error: unknown) => {
        if (settle()) {
          report(error);
        }
      });
  };

  /**
   * Scrolls a control that took the focus clear of the column of the names,
   * which stays on the left over the others: the browser scrolls only a
   * control outside the table's viewport, and one under that column is not.
   */
  const keepClear = (event: FocusEvent): void => {
    const scroller = part("scroller");
    const names = part("names");
    const target = event.target;
    if (scroller === null || names === null || !(target instanceof Element)) {
      return;
    }
    // The grid itself takes the focus too, and is no control to keep clear.
    if (names.contains(target) || target === part("grid")) {
      return;
    }
    const hidden = names.getBoundingClientRect().right - target.getBoundingClientRect().left;
    if (hidden > 0) {
      scroller.scrollLeft -= hidden;
    }
  };

  /**
   * Changes the role of `column`, after asking when the change would stop
   * the active classification; an answer of no draws the dropdown back.
   */
  const changeRole = (table: TableDescription, column: ColumnId, role: Role): void => {
    const described = table.columns.find((each) => each.id === column);
    if (described === undefined) {
      throw defect(`a change of role of column ${String(column)}, not in the table`);
    }
    const send = (): void => {
      connection
        .setRole(column, role)
        .then(answered("changing the role of a column", schedule), report);
    };
    const question = roleChangeQuestion(described, role, state.active()?.column ?? null);
    if (question === null) {
      send();
      return;
    }
    const withdraw = new AbortController();
    asking = { loadedAt: table.loadedAt, withdraw };
    ask(question, withdraw.signal).then((confirmed) => {
      if (asking?.withdraw === withdraw) {
        asking = null;
      }
      // A column of another table has the same id: the answer is about the
      // table asked about, which must still be the one loaded.
      if (confirmed && isLoaded(table.loadedAt)) {
        send();
      } else {
        schedule();
      }
    }, report);
  };

  /**
   * Selects the row clicked, or with `extend` the rows shown from the last
   * one clicked to it: a shift-click over a filtered table selects none of
   * the rows the filter hides between the two.
   */
  const select = (row: RowIndex, extend: boolean): void => {
    const project = state.project();
    if (project.kind !== "open") {
      return;
    }
    const from = extend && anchor !== null ? anchor : row;
    if (!extend) {
      anchor = row;
    }
    const bits = intersection(rangeBits(project.numRows, from, row), state.shown()?.bits ?? null);
    connection.setSelection(bits).then(answered("selecting rows", schedule), report);
  };

  /** Whether the table loaded at `at` is the one the copy holds. */
  const isLoaded = (at: Revision): boolean => {
    const project = state.project();
    return project.kind === "open" && project.loadedAt === at;
  };

  /** Gives the focus to the grid, when it is drawn. */
  const focusGrid = (): void => {
    part("grid")?.focus({ preventScroll: true });
  };

  const draw = (): void => {
    if (destroyed) {
      return;
    }
    if (asking !== null && !isLoaded(asking.loadedAt)) {
      asking.withdraw.abort();
      asking = null;
    }
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
    const shown = shownNow(table);
    const replaced = table.loadedAt !== loadedAt;
    /** Whether this table takes the place of another the table showed. */
    const another = replaced && loadedAt !== null;
    if (replaced) {
      pages.clear();
      fetching.clear();
      loadedAt = table.loadedAt;
      anchor = null;
      part("scroller")?.scrollTo({ top: 0 });
    }
    // A page ahead of the copy is kept, not drawn, until the message of
    // the change it holds arrives and makes it current.
    const drawable = new Map<number, RowPage>();
    for (const [index, page] of pages) {
      switch (standing(page, table, shown.at)) {
        case "current":
          drawable.set(index, page);
          break;
        case "ahead":
          break;
        case "behind":
          pages.delete(index);
          break;
      }
    }
    // Measured as laid out, not rounded to a whole pixel as offsetHeight
    // is: the blank above the rows is a multiple of the exact height.
    const scroller = part("scroller");
    const probe = part("probe");
    const measured =
      scroller === null || probe === null
        ? null
        : {
            scrollTop: scroller.scrollTop,
            viewport: scroller.clientHeight,
            rowHeight: probe.getBoundingClientRect().height,
          };
    const range =
      measured === null
        ? { first: 0, end: 0 }
        : rowsInView(
            measured.scrollTop,
            measured.viewport,
            measured.rowHeight,
            shown.numShown,
            MARGIN_ROWS,
          );
    const rows: TableRow[] = [];
    for (let position = range.first; position < range.end; position += 1) {
      const page = drawable.get(Math.floor(position / PAGE_ROWS)) ?? null;
      const row = rowAt(shown.rows, position);
      rows.push(tableRow(table, page, position, row, state.codes, state.selection(), mark));
    }
    render(
      tableView({
        columns: tableColumns(table),
        numRows: shown.numShown,
        range,
        rows,
        onRowClick: select,
        onRole: (column, role) => {
          changeRole(table, column, role);
        },
        onScroll: schedule,
        onFocusIn: keepClear,
      }),
      element,
    );
    if (another) {
      const focused = document.activeElement;
      if (focused === null || focused === document.body || element.contains(focused)) {
        focusGrid();
      }
    }
    // The first draw has nothing to measure yet: draw again once it has.
    if ((measured === null || measured.rowHeight === 0) && shown.numShown > 0) {
      schedule();
      return;
    }
    const needed = pagesOf(range);
    for (const index of needed) {
      if (!pages.has(index) && !fetching.has(index)) {
        fetchPage(index, table, shown.numShown);
      }
    }
    const low = needed[0];
    const high = needed.at(-1);
    if (low === undefined || high === undefined) {
      return;
    }
    for (const index of pages.keys()) {
      if (index < low - PAGES_KEPT || index > high + PAGES_KEPT) {
        pages.delete(index);
      }
    }
  };

  const resized = new ResizeObserver(schedule);
  resized.observe(element);
  const unsubscribes = (["table", "codes", "selection", "filter"] as const).map((aspect) =>
    state.subscribe(aspect, draw),
  );
  draw();
  return {
    redraw: draw,
    focus: focusGrid,
    destroy: () => {
      destroyed = true;
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
