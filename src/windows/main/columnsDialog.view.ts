import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";

import type { ColumnId } from "../../state/ids.ts";
import type { PlotColumn } from "../../state/plotColumns.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "../shared/dialog.module.css";

/** A dropdown of the dialog: its label, the columns it offers, and the one chosen. */
export interface ColumnField {
  /** Its label, which names what the column is for: "X axis", "Latitude column". */
  readonly label: string;
  /** The columns it offers, in the order of the table. */
  readonly columns: readonly PlotColumn[];
  /** The column chosen, one of `columns`. */
  readonly chosen: ColumnId;
}

/** What the dialog of a plot shows: its title, the plot's name, and a dropdown for each of its columns. */
export interface ColumnsChoice {
  /** The title, the name of the plot: "3D scatter", "Map", "Map of countries". */
  readonly title: string;
  /** The dropdowns, in the order of the plot's columns. */
  readonly fields: readonly ColumnField[];
}

/** What the dialog shows, and what the user's actions do. */
export interface ColumnsDialogProps {
  /** The choice shown, or `null` while the dialog is closed. */
  readonly choice: ColumnsChoice | null;
  /** The user chose `column` in the dropdown at `index`. */
  readonly onChange: (index: number, column: ColumnId) => void;
  /** The user answered: `true` to open the plot, `false` not to. */
  readonly onAnswer: (confirmed: boolean) => void;
}

function fieldSelect(
  field: ColumnField,
  index: number,
  onChange: (index: number, column: ColumnId) => void,
): TemplateResult {
  const id = `plot-column-${String(index)}`;
  return html`<label for=${id} class=${classOf(styles, "label")}>${field.label}</label>
    <select
      id=${id}
      class=${classOf(styles, "select")}
      @change=${(event: Event) => {
        const selected =
          event.target instanceof HTMLSelectElement ? event.target.selectedIndex : -1;
        const column = field.columns[selected];
        if (column !== undefined) {
          onChange(index, column.id);
        }
      }}
    >
      ${field.columns.map(
        (column) =>
          html`<option .selected=${live(column.id === field.chosen)}>${column.name}</option>`,
      )}
    </select>`;
}

/**
 * The dialog of an item of the Plot menu: a dropdown of the columns each
 * column of the plot can be, then Cancel and Open. The controller opens it
 * as a modal dialog; Enter opens, and Escape cancels.
 */
export function columnsDialogView(props: ColumnsDialogProps): TemplateResult {
  const { choice } = props;
  return html`<dialog
    class=${classOf(styles, "dialog")}
    aria-labelledby="plot-columns-heading"
    @cancel=${(event: Event) => {
      event.preventDefault();
      props.onAnswer(false);
    }}
    @keydown=${(event: KeyboardEvent) => {
      // Enter opens, as Open does, but on a button, whose own it is.
      if (
        event.key === "Enter" &&
        !event.isComposing &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        props.onAnswer(true);
      }
    }}
  >
    ${
      choice === null
        ? nothing
        : html`<h2 id="plot-columns-heading" class=${classOf(styles, "heading")}>
              ${choice.title}
            </h2>
            <div class=${classOf(styles, "fields")}>
              ${choice.fields.map((field, index) => fieldSelect(field, index, props.onChange))}
            </div>
            <div class=${classOf(styles, "answers")}>
              <button
                type="button"
                class=${classOf(styles, "answer")}
                @click=${() => {
                  props.onAnswer(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                class=${classOf(styles, "answer")}
                @click=${() => {
                  props.onAnswer(true);
                }}
              >
                Open
              </button>
            </div>`
    }
  </dialog>`;
}
