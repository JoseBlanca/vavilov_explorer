import { html } from "lit-html";
import type { TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { repeat } from "lit-html/directives/repeat.js";

import { defect } from "../../state/defect.ts";
import { MAX_FILTER_TEXT } from "../../state/filter.ts";
import type { ColumnId } from "../../state/ids.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "./findBar.module.css";

/** A column the Column dropdown offers. */
export interface FindColumn {
  /** Its id. */
  readonly id: ColumnId;
  /** Its name, as the table's header shows it. */
  readonly name: string;
}

/** What the find bar shows, and what the user's actions do. */
export interface FindBarProps {
  /** The text in the field. */
  readonly text: string;
  /** The columns of the table, IndividualID first. */
  readonly columns: readonly FindColumn[];
  /** The column searched, or `null` for any column. */
  readonly column: ColumnId | null;
  /** Whether "Whole cell" is ticked. */
  readonly whole: boolean;
  /** Whether "Show rows that don't match" is ticked. */
  readonly notMatching: boolean;
  /** The user typed in the field. */
  readonly onText: (text: string) => void;
  /** The user chose a column, or any. */
  readonly onColumn: (column: ColumnId | null) => void;
  /** The user ticked or unticked "Whole cell". */
  readonly onWhole: (whole: boolean) => void;
  /** The user ticked or unticked "Show rows that don't match". */
  readonly onNotMatching: (notMatching: boolean) => void;
}

/** The value of the option "Any column" in the Column dropdown. */
const ANY = "any";

/**
 * The column of the option `value` of the Column dropdown, `null` for any.
 *
 * @throws A defect for a value no option of `columns` has.
 */
function chosenColumn(value: string, columns: readonly FindColumn[]): ColumnId | null {
  if (value === ANY) {
    return null;
  }
  const chosen = columns.find((column) => String(column.id) === value);
  if (chosen === undefined) {
    throw defect(`a column ${value} chosen in the find bar, not in the table`);
  }
  return chosen.id;
}

/**
 * The find bar above the table (docs/design.md, section 2.1): the field of
 * the text searched for, the Column dropdown, "Any column" and then every
 * column, and the checkboxes "Whole cell" and "Show rows that don't
 * match".
 */
export function findBarView(props: FindBarProps): TemplateResult {
  return html`<div class=${classOf(styles, "bar")} role="search" aria-label="Find in the table">
    <label class=${classOf(styles, "field")}>
      <span>Find</span>
      <input
        type="search"
        class=${classOf(styles, "text")}
        maxlength=${String(MAX_FILTER_TEXT)}
        .value=${live(props.text)}
        @input=${(event: Event) => {
          if (event.target instanceof HTMLInputElement) {
            props.onText(event.target.value);
          }
        }}
      />
    </label>
    <label class=${classOf(styles, "field")}>
      <span>Column</span>
      <select
        class=${classOf(styles, "select")}
        @change=${(event: Event) => {
          if (event.target instanceof HTMLSelectElement) {
            props.onColumn(chosenColumn(event.target.value, props.columns));
          }
        }}
      >
        <option value=${ANY} .selected=${live(props.column === null)}>Any column</option>
        ${repeat(
          props.columns,
          (column) => column.id,
          (column) =>
            html`<option value=${String(column.id)} .selected=${live(props.column === column.id)}>
              ${column.name}
            </option>`,
        )}
      </select>
    </label>
    <label class=${classOf(styles, "check")}>
      <input
        type="checkbox"
        .checked=${live(props.whole)}
        @change=${(event: Event) => {
          if (event.target instanceof HTMLInputElement) {
            props.onWhole(event.target.checked);
          }
        }}
      />
      Whole cell
    </label>
    <label class=${classOf(styles, "check")}>
      <input
        type="checkbox"
        .checked=${live(props.notMatching)}
        @change=${(event: Event) => {
          if (event.target instanceof HTMLInputElement) {
            props.onNotMatching(event.target.checked);
          }
        }}
      />
      Show rows that don't match
    </label>
  </div>`;
}
