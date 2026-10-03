import { nothing, render } from "lit-html";

import type { Connection } from "../../backend/connection.ts";
import type { BarMessage } from "../../state/barMessages.ts";
import { moved, positionOf } from "../../state/activeCell.ts";
import type { ActiveCell, Move } from "../../state/activeCell.ts";
import { editedRows, offersSelected, openedEdit } from "../../state/cellEdit.ts";
import type { CellEdit } from "../../state/cellEdit.ts";
import { cellRefusalMessage } from "../../state/cellMessages.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow, Role, TableDescription } from "../../state/description.ts";
import { rowAt, shownBetween, shownRowsOf } from "../../state/filter.ts";
import type { Shown } from "../../state/filter.ts";
import type { ColumnId, Revision, RowIndex } from "../../state/ids.ts";
import type { Question } from "../../state/question.ts";
import { roleChangeQuestion } from "../../state/roles.ts";
import type { RowPage } from "../../state/rowPage.ts";
import {
  NO_ROWS,
  PAGE_ROWS,
  checkPageRefusal,
  pageStanding,
  pagesOf,
  positionsIn,
  rowsInView,
  rowsOfPage,
} from "../../state/tablePages.ts";
import { countRows, hasRow } from "../../state/rowSet.ts";
import { fetchedColumns, tableColumns, tableRow } from "../../state/tableRows.ts";
import type { TableRow } from "../../state/tableRows.ts";
import { answered } from "../shared/answered.ts";
import { ACTIVE_CELL_ID, tableView } from "./table.view.ts";

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
 * How long a click on a row of a selection of several waits for a second
 * click before it selects that row alone, in milliseconds: Windows' default
 * double-click time, 500 ms, so that a double-click that opens a cell keeps
 * the selection "Apply to all selected rows" applies to.
 */
const DOUBLE_CLICK_MS = 500;

/**
 * The table of the main window: it draws the rows on screen, fetches their
 * pages from the backend, and turns a click on a row into the selection
 * (docs/design.md, section 2.1). It keeps the pages it fetched, the scroll and
 * the row of the last click, the anchor of a shift-click; everything else is
 * the window's copy of the state. A change of role that would stop the
 * active classification is put to the user with `ask` first, and the
 * question is withdrawn when another table is loaded meanwhile. When
 * another table takes the place of the one drawn, the focus goes to its
 * grid from a control of the table it replaced, or from nowhere. A
 * double-click opens a cell for editing, which it keeps as its own until
 * Enter or leaving the cell sends the value to the backend, whose refusal
 * goes to `tell`, or Escape gives it up.
 */
export function createTable(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  decimalMark: string,
  ask: (question: Question, withdrawn: AbortSignal) => Promise<boolean>,
  tell: (message: BarMessage) => void,
  report: (error: unknown) => void,
): Table {
  const { state } = connection;
  const pages = new Map<number, RowPage>();
  /** The fetch of each page on its way, by a token of its own. */
  const fetching = new Map<number, object>();
  let loadedAt: Revision | null = null;
  let anchor: RowIndex | null = null;
  /** Whether the last move of the keyboard extended the selection with Shift. */
  let extending = false;
  let frame: number | null = null;
  let destroyed = false;
  /** The cell being edited, and whether its field is still to take the focus. */
  let editing: CellEdit | null = null;
  /** The cell the keyboard is on, and whether it is still to be scrolled into view. */
  let active: ActiveCell | null = null;
  let revealing = false;
  let editorOpened = false;
  /** The rows drawn last, from which a cell double-clicked is opened. */
  let drawnRows: readonly TableRow[] = [];
  /** The click on a row of a selection of several that waits for a second one. */
  let narrowing: number | null = null;
  /** The question about a role being asked, and the load of the table it is about. */
  let asking: { readonly loadedAt: Revision; readonly withdraw: AbortController } | null = null;
  /**
   * The row of the table at each position among those shown, `null` when
   * the position is the row, for the rows shown since `at`: worked out once
   * for each change of the rows shown.
   */
  let rowsByPosition: { readonly at: Revision; readonly rows: Uint32Array | null } | null = null;

  /** The rows shown now, and the row at each of their positions. */
  const shownNow = (table: TableDescription): { shown: Shown; rows: Uint32Array | null } => {
    const shown = state.shown();
    if (shown === null) {
      throw defect("a table drawn with no rows shown in the copy");
    }
    if (rowsByPosition?.at !== shown.at) {
      rowsByPosition = { at: shown.at, rows: shownRowsOf(shown) };
    }
    if (shown.bits === null && shown.numShown !== table.numRows) {
      throw defect(
        `every row shown, ${String(shown.numShown)}, of a table of ${String(table.numRows)} rows`,
      );
    }
    return { shown, rows: rowsByPosition.rows };
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

  /** How page `index` stands against the copy and the description. */
  const standing = (
    page: RowPage,
    index: number,
    table: TableDescription,
    shown: Shown,
  ): ReturnType<typeof pageStanding> =>
    pageStanding(
      page,
      index,
      table.loadedAt,
      shown,
      fetchedColumns(table),
      state.columnRevision,
      table.names.id,
    );

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
      .then(
        (answer) => {
          if (!settle()) {
            return;
          }
          if (!answer.ok) {
            // Fewer rows were shown by the time the backend read the fetch,
            // and the page asked for is past them: the draw fetches the
            // pages of those shown now.
            checkPageRefusal(answer.error, numShown);
            schedule();
            return;
          }
          // A page of a table since replaced is dropped, and the draw fetches
          // the page of the table there is now.
          if (answer.value !== "stale" && answer.value.loadedAt === loadedAt) {
            pages.set(index, answer.value);
          }
          schedule();
        },
        // A fetch fails only by a defect, which is reported even when the
        // fetch was made for a table since replaced.
        (error: unknown) => {
          settle();
          report(error);
        },
      )
      .catch(report);
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
  const select = (row: RowIndex, extend: boolean, by: "mouse" | "keyboard" = "mouse"): void => {
    const project = state.project();
    if (project.kind !== "open") {
      return;
    }
    if (!extend) {
      extending = false;
    }
    stopNarrowing();
    const from = extend && anchor !== null ? anchor : row;
    if (!extend) {
      anchor = row;
    }
    const send = (): void => {
      const bits = shownBetween(project.numRows, from, row, state.shown());
      connection.setSelection(bits).then(answered("selecting rows", schedule), report);
    };
    const selection = state.selection();
    if (
      by === "mouse" &&
      !extend &&
      selection !== null &&
      hasRow(selection, row) &&
      countRows(selection) > 1
    ) {
      narrowing = window.setTimeout(() => {
        narrowing = null;
        if (isLoaded(project.loadedAt)) {
          send();
        }
      }, DOUBLE_CLICK_MS);
      return;
    }
    send();
  };

  const stopNarrowing = (): void => {
    if (narrowing !== null) {
      clearTimeout(narrowing);
      narrowing = null;
    }
  };

  /** Opens the cell of `row` in `column` for editing, when it is drawn with its values. */
  const openCell = (table: TableDescription, row: RowIndex, column: ColumnId): void => {
    stopNarrowing();
    const index = tableColumns(table, decimalMark).findIndex((each) => each.id === column);
    const cell = drawnRows.find((each) => each.row === row)?.cells?.[index];
    if (cell === undefined) {
      return;
    }
    editing = openedEdit(table.loadedAt, row, column, table.names.id, cell);
    editorOpened = true;
    draw();
  };

  /**
   * Closes the list of values the field of the cell being edited suggests,
   * before the field goes: WebKit kept the list on screen when the field
   * went while it was open.
   */
  const closeSuggestions = (): void => {
    const field = element.querySelector("[data-editor] input");
    if (field instanceof HTMLInputElement) {
      field.removeAttribute("list");
      field.blur();
    }
  };

  /**
   * Sends the value of the cell being edited, and closes it, giving the
   * focus back to the grid after Enter; after the focus left the cell, it
   * stays where it went.
   */
  const commitEdit = (how: "enter" | "left"): void => {
    const edit = editing;
    if (edit === null) {
      return;
    }
    const project = state.project();
    const selection = state.selection();
    editing = null;
    closeSuggestions();
    if (how === "enter") {
      // As in a spreadsheet, Enter moves on to the cell below.
      if (active?.row === edit.row && active.column === edit.column) {
        moveActive("down");
      }
      focusGrid();
    }
    draw();
    if (project.kind !== "open" || project.loadedAt !== edit.loadedAt) {
      return;
    }
    if (selection === null) {
      throw defect("a cell edited in a table with no selection in the copy");
    }
    connection
      .setCells(edit.column, editedRows(edit, project.numRows, selection), edit.text, decimalMark)
      .then((answer) => {
        if (!answer.ok && answer.error.kind === "cellRefused") {
          tell(cellRefusalMessage(answer.error));
          return;
        }
        answered("editing cells", schedule)(answer);
      }, report);
  };

  /** Gives up the cell being edited, after Escape, and gives the focus back to the grid. */
  const cancelEdit = (): void => {
    if (editing === null) {
      return;
    }
    editing = null;
    closeSuggestions();
    draw();
    focusGrid();
  };

  /**
   * Moves the cell the keyboard is on by `move`, and scrolls it into view.
   * With `extend`, Shift held, the selection becomes the rows from the row
   * where the run of such moves started to the cell's new row, as a
   * shift-click does.
   */
  const moveActive = (move: Move, extend = false): void => {
    const now = description();
    if (now.kind !== "current") {
      return;
    }
    const { shown, rows } = shownNow(now.description);
    const scroller = part("scroller");
    const probe = part("probe");
    const rowHeight = probe?.getBoundingClientRect().height ?? 0;
    const pageRows =
      scroller === null || rowHeight === 0
        ? 1
        : Math.max(1, Math.floor(scroller.clientHeight / rowHeight) - 2);
    const from = active?.row ?? null;
    active = moved(
      active,
      move,
      tableColumns(now.description, decimalMark).map((column) => column.id),
      { numShown: shown.numShown, rows },
      pageRows,
    );
    revealing = true;
    schedule();
    if (active === null) {
      return;
    }
    if (extend) {
      if (!extending) {
        anchor = from;
        extending = true;
      }
      select(active.row, true, "keyboard");
    } else {
      extending = false;
    }
  };

  /**
   * Scrolls the cell the keyboard is on into view, clear of the header and
   * of the column of the names, which stay over the others; to its row
   * first when that is not drawn, and again once it is.
   */
  const reveal = (table: TableDescription): void => {
    revealing = false;
    const scroller = part("scroller");
    if (active === null || scroller === null) {
      return;
    }
    const cell = element.querySelector(`#${ACTIVE_CELL_ID}`);
    if (!(cell instanceof HTMLElement)) {
      const { shown, rows } = shownNow(table);
      const position = positionOf(active.row, { numShown: shown.numShown, rows });
      const rowHeight = part("probe")?.getBoundingClientRect().height ?? 0;
      if (position !== null && rowHeight > 0) {
        scroller.scrollTop = position * rowHeight;
        revealing = true;
        schedule();
      }
      return;
    }
    const box = cell.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const headerBottom =
      element.querySelector('[aria-rowindex="1"]')?.getBoundingClientRect().bottom ?? view.top;
    const namesRight = part("names")?.getBoundingClientRect().right ?? view.left;
    const bottom = view.top + scroller.clientHeight;
    const right = view.left + scroller.clientWidth;
    if (box.top < headerBottom) {
      scroller.scrollTop -= headerBottom - box.top;
    } else if (box.bottom > bottom) {
      scroller.scrollTop += box.bottom - bottom;
    }
    if (active.column !== table.names.id) {
      if (box.left < namesRight) {
        scroller.scrollLeft -= namesRight - box.left;
      } else if (box.right > right) {
        scroller.scrollLeft += box.right - right;
      }
    }
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
    const { shown, rows: rowAtPosition } = shownNow(table);
    const replaced = table.loadedAt !== loadedAt;
    /** Whether this table takes the place of another the table showed. */
    const another = replaced && loadedAt !== null;
    if (replaced) {
      pages.clear();
      fetching.clear();
      loadedAt = table.loadedAt;
      anchor = null;
      editing = null;
      active = null;
      stopNarrowing();
      part("scroller")?.scrollTo({ top: 0 });
    }
    // A page ahead of the copy is kept, not drawn, until the message of
    // the change it holds arrives and makes it current.
    const drawable = new Map<number, RowPage>();
    for (const [index, page] of pages) {
      switch (standing(page, index, table, shown)) {
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
        ? NO_ROWS
        : rowsInView(
            measured.scrollTop,
            measured.viewport,
            measured.rowHeight,
            shown.numShown,
            MARGIN_ROWS,
          );
    const rows: TableRow[] = positionsIn(range).map((position) =>
      tableRow(
        table,
        drawable.get(Math.floor(position / PAGE_ROWS)) ?? null,
        position,
        rowAt(rowAtPosition, position),
        state.codes,
        state.selection(),
        decimalMark,
      ),
    );
    drawnRows = rows;
    render(
      tableView({
        columns: tableColumns(table, decimalMark),
        numShown: shown.numShown,
        range,
        rows,
        editing,
        offersSelected: (() => {
          const selection = state.selection();
          return editing !== null && selection !== null
            ? offersSelected(editing, selection)
            : false;
        })(),
        active,
        onGridFocus: () => {
          if (
            active === null ||
            positionOf(active.row, { numShown: shown.numShown, rows: rowAtPosition }) === null
          ) {
            moveActive("down");
          }
        },
        onMove: moveActive,
        onActiveOpen: () => {
          if (active !== null) {
            openCell(table, active.row, active.column);
          }
        },
        onActiveSelect: (extend) => {
          if (active !== null) {
            select(active.row, extend, "keyboard");
          }
        },
        onCellClick: (row, column) => {
          active = { row, column };
        },
        onRowClick: (row, extend) => {
          select(row, extend);
        },
        onCellOpen: (row, column) => {
          openCell(table, row, column);
        },
        onEditText: (text) => {
          if (editing !== null) {
            editing = { ...editing, text };
            // The values suggested follow the text.
            draw();
          }
        },
        onEditToSelected: (toSelected) => {
          if (editing !== null) {
            editing = { ...editing, toSelected };
            draw();
          }
        },
        onEditCommit: () => {
          commitEdit("enter");
        },
        onEditCancel: cancelEdit,
        onEditLeave: () => {
          commitEdit("left");
        },
        onRole: (column, role) => {
          changeRole(table, column, role);
        },
        onScroll: schedule,
        onFocusIn: keepClear,
      }),
      element,
    );
    if (revealing) {
      reveal(table);
    }
    if (editorOpened) {
      const field = element.querySelector("[data-editor] input");
      if (field instanceof HTMLInputElement) {
        editorOpened = false;
        field.focus();
        field.select();
      }
    }
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
      stopNarrowing();
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
