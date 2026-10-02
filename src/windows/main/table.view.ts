import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { styleMap } from "lit-html/directives/style-map.js";

import type { Cell } from "../../state/cellText.ts";
import type { RowIndex } from "../../state/ids.ts";
import type { RowRange } from "../../state/tablePages.ts";
import type { TableColumn, TableRow } from "../../state/tableRows.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "./table.module.css";

/** What the table shows, and what the user can do there. */
export interface TableProps {
  /** The columns, the names first. */
  readonly columns: readonly TableColumn[];
  /** The rows of the table, of which only `range` is drawn. */
  readonly numRows: number;
  /** The rows drawn; the others are blank space of the same height. */
  readonly range: RowRange;
  /** The rows of `range`, in order. */
  readonly rows: readonly TableRow[];
  /** The user clicked a row, with the shift key when `extend`. */
  readonly onRowClick: (row: RowIndex, extend: boolean) => void;
  /** The user scrolled the table. */
  readonly onScroll: () => void;
}

/** The width of each type of column, a token of tokens.css. */
const WIDTHS: Readonly<Record<TableColumn["type"], string>> = {
  names: "var(--column-names)",
  numeric: "var(--column-number)",
  integer: "var(--column-number)",
  text: "var(--column-text)",
  boolean: "var(--column-boolean)",
  categorical: "var(--column-categorical)",
};

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

function cellView(cell: Cell, first: boolean): TemplateResult {
  const place = first ? "nameCell" : "cell";
  if (cell.kind === "missing") {
    return html`<div role="gridcell" class=${classOf(styles, place)}>
      <span class=${classOf(styles, "hidden")}>missing</span>
    </div>`;
  }
  return html`<div
    role="gridcell"
    class="${classOf(styles, place)} ${classOf(styles, cell.align === "end" ? "end" : "start")}"
    title=${cell.text}
  >
    ${cell.text}
  </div>`;
}

/**
 * The table of the main window (docs/design.md, section 2.1): a header with
 * the name of each column, and the rows on screen, each selected or not; a
 * click selects a row, and a shift-click the rows from the last one clicked.
 * Only the rows of `range` are drawn, between blank space as tall as the
 * rows above and below them, so the scroll bar is that of the whole table.
 */
export function tableView(props: TableProps): TemplateResult {
  const columns = props.columns.map((column) => WIDTHS[column.type]).join(" ");
  return html`<div class=${classOf(styles, "scroller")} data-scroller @scroll=${props.onScroll}>
    <div class=${classOf(styles, "probe")} data-probe aria-hidden="true"></div>
    <div
      role="grid"
      class=${classOf(styles, "grid")}
      style=${styleMap({ gridTemplateColumns: columns })}
      aria-label="Individuals"
      aria-rowcount=${String(props.numRows + 1)}
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
              class="${classOf(styles, index === 0 ? "nameHeading" : "heading")} ${classOf(
                styles,
                column.type === "numeric" || column.type === "integer" ? "end" : "start",
              )}"
              title=${column.name}
            >
              ${
                column.name === ""
                  ? html`<span class=${classOf(styles, "hidden")}>Individual</span>`
                  : column.name
              }
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
            aria-rowindex=${String(row.row + 2)}
            aria-selected=${row.selected ? "true" : "false"}
            aria-busy=${row.cells === null ? "true" : "false"}
            @mousedown=${(event: MouseEvent) => {
              // A shift-click extends the selection, and must not select
              // the text of the rows between.
              if (event.shiftKey) {
                event.preventDefault();
              }
            }}
            @click=${(event: MouseEvent) => {
              props.onRowClick(row.row, event.shiftKey);
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
                : row.cells.map((cell, index) => cellView(cell, index === 0))
            }
          </div>`,
      )}
      ${blank(props.numRows - props.range.end)}
    </div>
  </div>`;
}
