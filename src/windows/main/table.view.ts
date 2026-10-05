import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { repeat } from "lit-html/directives/repeat.js";
import { styleMap } from "lit-html/directives/style-map.js";

import type { ActiveCell, Move } from "../../state/activeCell.ts";
import { suggestedValues } from "../../state/cellEdit.ts";
import type { CellEdit } from "../../state/cellEdit.ts";
import type { Cell } from "../../state/cellText.ts";
import type { Role } from "../../state/description.ts";
import type { ColumnId, RowIndex } from "../../state/ids.ts";
import type { RowRange } from "../../state/tablePages.ts";
import type { TableColumn, TableRow } from "../../state/tableRows.ts";
import { defect } from "../../state/defect.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "./table.module.css";

/** What the table shows, and what the user can do there. */
export interface TableProps {
  /** The columns, the names first. */
  readonly columns: readonly TableColumn[];
  /** The rows the filter shows, of which only `range` is drawn. */
  readonly numShown: number;
  /** The rows drawn; the others are blank space of the same height. */
  readonly range: RowRange;
  /** The rows of `range`, in order. */
  readonly rows: readonly TableRow[];
  /** The cell being edited, or `null`. */
  readonly editing: CellEdit | null;
  /** Whether the cell being edited offers "Apply to all selected rows". */
  readonly offersSelected: boolean;
  /** The cell the keyboard is on, or `null`. */
  readonly active: ActiveCell | null;
  /** The grid took the focus. */
  readonly onGridFocus: () => void;
  /** The user pressed a key that moves the cell the keyboard is on, with Shift up or down when `extend`. */
  readonly onMove: (move: Move, extend: boolean) => void;
  /** The user pressed Enter on the cell the keyboard is on. */
  readonly onActiveOpen: () => void;
  /** The user pressed Space on the cell the keyboard is on, with Shift when `extend`. */
  readonly onActiveSelect: (extend: boolean) => void;
  /** The user clicked a cell, which the keyboard is then on. */
  readonly onCellClick: (row: RowIndex, column: ColumnId) => void;
  /**
   * The user clicked a row, with the shift key when `extend`; `clicks` is
   * the browser's count, 2 for the second click of a double-click.
   */
  readonly onRowClick: (row: RowIndex, extend: boolean, clicks: number) => void;
  /** The user double-clicked a cell, to edit it. */
  readonly onCellOpen: (row: RowIndex, column: ColumnId) => void;
  /** The user typed in the field of the cell being edited. */
  readonly onEditText: (text: string) => void;
  /** The user ticked or unticked "Apply to all selected rows". */
  readonly onEditToSelected: (ticked: boolean) => void;
  /** The user pressed Enter in the cell being edited. */
  readonly onEditCommit: () => void;
  /** The user pressed Escape in the cell being edited. */
  readonly onEditCancel: () => void;
  /** The focus left the cell being edited for another place, which applies it. */
  readonly onEditLeave: () => void;
  /** The user chose a role for a column. */
  readonly onRole: (column: ColumnId, role: Role) => void;
  /** The user scrolled the table. */
  readonly onScroll: () => void;
  /** A control of the table took the focus. */
  readonly onFocusIn: (event: FocusEvent) => void;
}

/** The width of the first column and of each role, a token of tokens.css. */
const WIDTHS: Readonly<Record<TableColumn["kind"], string>> = {
  names: "var(--column-names)",
  number: "var(--column-number)",
  latitude: "var(--column-number)",
  longitude: "var(--column-number)",
  text: "var(--column-text)",
  category: "var(--column-categorical)",
  country: "var(--column-categorical)",
};

/** The dropdown of the roles a column can take. */
function roleSelect(column: TableColumn, onRole: TableProps["onRole"]): TemplateResult {
  return html`<select
    class=${classOf(styles, "role")}
    aria-label=${`Role of ${column.name}`}
    @change=${(event: Event) => {
      const chosen = column.choices.find(
        (choice) => event.target instanceof HTMLSelectElement && choice.role === event.target.value,
      );
      if (chosen !== undefined) {
        onRole(column.id, chosen.role);
      }
    }}
  >
    ${column.choices.map(
      (choice) =>
        html`<option value=${choice.role} .selected=${live(choice.role === column.kind)}>
          ${choice.label}
        </option>`,
    )}
  </select>`;
}

/** The empty space that stands for `count` rows not drawn. */
function blank(count: number): TemplateResult | typeof nothing {
  return count <= 0
    ? nothing
    : html`<div
        class=${classOf(styles, "blank")}
        style=${styleMap({ height: `calc(var(--row-height) * ${String(count)})` })}
        aria-hidden="true"
      ></div>`;
}

/** The id of the list of the values the field of a category's cell suggests. */
const VALUES_LIST = "table-cell-values";

/**
 * The field of the cell being edited, of `column` in the row of the
 * individual `individual`: the values of a category suggested as the user
 * types, and, when the cell's row is one of several selected, the checkbox
 * "Apply to all selected rows" to the right of the cell, or to its left in
 * the last column, where the list of suggestions below the field does not
 * cover it. Enter applies, and so does leaving the field and
 * its checkbox; Escape gives the cell back as it was.
 */
function editorView(
  edit: CellEdit,
  column: TableColumn,
  individual: string,
  place: { readonly first: boolean; readonly last: boolean },
  props: TableProps,
): TemplateResult {
  const { first, last } = place;
  const stop = (event: Event): void => {
    // A click in the editor is not a click on its row.
    event.stopPropagation();
  };
  return html`<div
    role="gridcell"
    class="${classOf(styles, first ? "nameCell" : "cell")} ${classOf(styles, "editing")}"
    data-editor
    @click=${stop}
    @dblclick=${stop}
    @mousedown=${(event: MouseEvent) => {
      stop(event);
      // WebKit gives no focus to a checkbox clicked, so the field would
      // seem left: a press beside the field keeps the focus in it, and the
      // click still ticks the checkbox.
      if (!(event.target instanceof HTMLInputElement && event.target.type === "text")) {
        event.preventDefault();
      }
    }}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        props.onEditCommit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        props.onEditCancel();
      }
    }}
    @focusout=${(event: FocusEvent) => {
      const editor = event.currentTarget;
      const next = event.relatedTarget;
      if (editor instanceof Element && !(next instanceof Node && editor.contains(next))) {
        props.onEditLeave();
      }
    }}
  >
    <input
      class=${classOf(styles, "editor")}
      aria-label=${`${column.name} of ${individual}`}
      list=${column.values.length > 0 ? VALUES_LIST : nothing}
      autocomplete="off"
      spellcheck="false"
      .value=${live(edit.text)}
      @input=${(event: Event) => {
        if (event.target instanceof HTMLInputElement) {
          props.onEditText(event.target.value);
        }
      }}
    />
    ${
      column.values.length > 0
        ? html`<datalist id=${VALUES_LIST}>
            ${suggestedValues(column.values, edit.text).map(
              (value) => html`<option value=${value}></option>`,
            )}
          </datalist>`
        : nothing
    }
    ${
      props.offersSelected
        ? html`<label class=${classOf(styles, last ? "toSelectedLeft" : "toSelectedRight")}>
            <input
              type="checkbox"
              .checked=${live(edit.toSelected)}
              @change=${(event: Event) => {
                if (event.target instanceof HTMLInputElement) {
                  props.onEditToSelected(event.target.checked);
                }
              }}
            />
            Apply to all selected rows
          </label>`
        : nothing
    }
  </div>`;
}

/** The id of the cell the keyboard is on, which the grid names as its active descendant. */
export const ACTIVE_CELL_ID = "table-active-cell";

/** What a cell does when the user clicks it, double-clicks it, and whether the keyboard is on it. */
interface CellEvents {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly onOpen: () => void;
}

function cellView(cell: Cell, first: boolean, events: CellEvents): TemplateResult {
  const place = classOf(styles, first ? "nameCell" : "cell");
  const active = events.active ? classOf(styles, "active") : "";
  if (cell.kind === "missing") {
    return html`<div
      role="gridcell"
      class="${place} ${active}"
      id=${events.active ? ACTIVE_CELL_ID : nothing}
      @click=${events.onClick}
      @dblclick=${events.onOpen}
    >
      <span class=${classOf(styles, "hidden")}>missing</span>
    </div>`;
  }
  return html`<div
    role="gridcell"
    class="${place} ${classOf(styles, cell.align === "end" ? "end" : "start")} ${active}"
    id=${events.active ? ACTIVE_CELL_ID : nothing}
    title=${cell.text}
    @click=${events.onClick}
    @dblclick=${events.onOpen}
  >
    ${cell.text}
  </div>`;
}

/** The cells of `row`, the one being edited, if any, as its field. */
function cellsView(row: TableRow, cells: readonly Cell[], props: TableProps): TemplateResult[] {
  const nameCell = cells[0];
  const individual = nameCell?.kind === "value" ? nameCell.text : "";
  const { editing } = props;
  return cells.map((cell, index) => {
    const column = props.columns[index];
    if (column === undefined) {
      throw defect(`a cell ${String(index)} of a table of ${String(props.columns.length)} columns`);
    }
    if (editing?.row === row.row && editing.column === column.id) {
      return editorView(
        editing,
        column,
        individual,
        { first: index === 0, last: index === props.columns.length - 1 },
        props,
      );
    }
    return cellView(cell, index === 0, {
      active: props.active?.row === row.row && props.active.column === column.id,
      onClick: () => {
        props.onCellClick(row.row, column.id);
      },
      onOpen: () => {
        props.onCellOpen(row.row, column.id);
      },
    });
  });
}

/** Whether the cell the keyboard is on is drawn with its values, not being edited. */
function activeDrawn(props: TableProps): boolean {
  const { active, editing } = props;
  if (active === null || (editing?.row === active.row && editing.column === active.column)) {
    return false;
  }
  return props.rows.some((row) => row.row === active.row && row.cells !== null);
}

/** The moves of the keys of the table, when the grid itself has the focus. */
const MOVES: ReadonlyMap<string, Move> = new Map([
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
  ["Home", "home"],
  ["End", "end"],
  ["PageUp", "pageUp"],
  ["PageDown", "pageDown"],
] as const);

/**
 * A key pressed on the grid, not in a control inside it: an arrow, Home,
 * End, Page Up or Page Down moves the cell the keyboard is on, and with
 * Shift a move up or down extends the selection to its row; Enter opens
 * it for editing, Space selects its row and Shift-Space the rows from the
 * last one selected.
 */
function gridKey(event: KeyboardEvent, props: TableProps): void {
  if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const move = MOVES.get(event.key);
  if (move !== undefined) {
    event.preventDefault();
    // Shift with a move up or down extends the selection, as in a spreadsheet.
    const vertical = move === "up" || move === "down" || move === "pageUp" || move === "pageDown";
    props.onMove(move, event.shiftKey && vertical);
  } else if (event.key === "Enter") {
    event.preventDefault();
    props.onActiveOpen();
  } else if (event.key === " ") {
    event.preventDefault();
    props.onActiveSelect(event.shiftKey);
  }
}

/**
 * The table of the main window (docs/design.md, section 2.1): a header with
 * the name of each column and the dropdown of its role, and the rows on screen, each selected or not; a
 * click selects a row, and a shift-click the rows from the last one clicked;
 * a double-click opens a cell for editing. The grid is in the order of Tab,
 * and the keyboard moves on its cells (gridKey).
 * Only the rows of `range` are drawn, between blank space as tall as the
 * rows above and below them, so the scroll bar is that of the whole table.
 * The grid can take the focus from the controller, not from Tab.
 */
export function tableView(props: TableProps): TemplateResult {
  const columns = props.columns.map((column) => WIDTHS[column.kind]).join(" ");
  return html`<div class=${classOf(styles, "frame")}>
    <div
      class=${classOf(styles, "scroller")}
      data-scroller
      @scroll=${props.onScroll}
      @focusin=${props.onFocusIn}
    >
      <div class=${classOf(styles, "probe")} data-probe aria-hidden="true"></div>
      <div
        role="grid"
        class=${classOf(styles, "grid")}
        data-grid
        tabindex="0"
        aria-activedescendant=${activeDrawn(props) ? ACTIVE_CELL_ID : nothing}
        @focus=${props.onGridFocus}
        @keydown=${(event: KeyboardEvent) => {
          gridKey(event, props);
        }}
        style=${styleMap({ gridTemplateColumns: columns })}
        aria-label="Individuals"
        aria-rowcount=${String(props.numShown + 1)}
        aria-colcount=${String(props.columns.length)}
        aria-multiselectable="true"
      >
        <div role="row" class=${classOf(styles, "header")} aria-rowindex="1">
          ${repeat(
            props.columns,
            (column) => column.id,
            (column, index) =>
              html`<div
                role="columnheader"
                ?data-names=${index === 0}
                class="${classOf(styles, index === 0 ? "nameHeading" : "heading")} ${classOf(
                  styles,
                  column.alignEnd ? "end" : "start",
                )}"
              >
                <span class=${classOf(styles, "headingName")} title=${column.name}>
                  ${column.name}
                </span>
                ${column.kind === "names" ? nothing : roleSelect(column, props.onRole)}
              </div>`,
          )}
        </div>
        ${blank(props.range.first)}
        ${repeat(
          props.rows,
          (row) => row.row,
          (row) =>
            html`<div
              role="row"
              class=${classOf(styles, "row")}
              aria-rowindex=${String(row.position + 2)}
              aria-selected=${row.selected ? "true" : "false"}
              data-outside=${row.outside ? "true" : "false"}
              aria-busy=${row.cells === null ? "true" : "false"}
              @mousedown=${(event: MouseEvent) => {
                // A shift-click extends the selection, and must not select
                // the text of the rows between.
                if (event.shiftKey) {
                  event.preventDefault();
                }
              }}
              @click=${(event: MouseEvent) => {
                props.onRowClick(row.row, event.shiftKey, event.detail);
              }}
            >
              ${
                row.cells === null
                  ? props.columns.map(
                      (_, index) =>
                        html`<div
                          role="gridcell"
                          class=${classOf(styles, index === 0 ? "nameCell" : "cell")}
                        ></div>`,
                    )
                  : cellsView(row, row.cells, props)
              }
            </div>`,
        )}
        ${blank(props.numShown - props.range.end)}
      </div>
    </div>
  </div>`;
}
