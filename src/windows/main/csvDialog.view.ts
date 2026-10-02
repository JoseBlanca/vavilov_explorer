import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";

import type { Separator } from "../../state/fileRefusal.ts";
import type { CsvChoices, CsvEncoding, DecimalMark, MissingText } from "../../state/transfer.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "../shared/dialog.module.css";

/** What the dialog of a CSV's choices shows, and what the user's actions do. */
export interface CsvDialogProps {
  /** The choices shown, or `null` while the dialog is closed. */
  readonly choices: CsvChoices | null;
  /** The decimal marks the separator shown allows, in the order they are offered. */
  readonly decimalMarks: readonly DecimalMark[];
  /** The user changed a choice. */
  readonly onChange: (choices: CsvChoices) => void;
  /** The user answered: `true` to export with the choices shown, `false` not to. */
  readonly onAnswer: (confirmed: boolean) => void;
}

/** One dropdown of the dialog: its label, and the words of each value. */
interface Field<K extends keyof CsvChoices> {
  readonly key: K;
  /** The id of its dropdown, which its label names. */
  readonly id: string;
  readonly label: string;
  readonly options: readonly (readonly [CsvChoices[K], string])[];
}

const SEPARATOR: Field<"separator"> = {
  key: "separator",
  id: "csv-separator",
  label: "Separator",
  options: [
    ["semicolon", "Semicolon (;)"],
    ["comma", "Comma (,)"],
    ["tab", "Tab"],
  ] satisfies (readonly [Separator, string])[],
};
const DECIMAL: Field<"decimal"> = {
  key: "decimal",
  id: "csv-decimal",
  label: "Decimal mark",
  options: [
    ["comma", "Comma (1,5)"],
    ["point", "Point (1.5)"],
  ] satisfies (readonly [DecimalMark, string])[],
};
const ENCODING: Field<"encoding"> = {
  key: "encoding",
  id: "csv-encoding",
  label: "Encoding",
  options: [
    ["utf8WithMark", "UTF-8 for Excel"],
    ["utf8", "UTF-8"],
    ["windows1252", "Windows-1252"],
  ] satisfies (readonly [CsvEncoding, string])[],
};
const MISSING: Field<"missing"> = {
  key: "missing",
  id: "csv-missing",
  label: "Missing values",
  options: [
    ["empty", "Empty cells"],
    ["na", "NA"],
  ] satisfies (readonly [MissingText, string])[],
};

function select<K extends keyof CsvChoices>(
  field: Field<K>,
  choices: CsvChoices,
  onChange: (choices: CsvChoices) => void,
): TemplateResult {
  return html`<label for=${field.id} class=${classOf(styles, "label")}>${field.label}</label>
    <select
      id=${field.id}
      class=${classOf(styles, "select")}
      @change=${(event: Event) => {
        const index = event.target instanceof HTMLSelectElement ? event.target.selectedIndex : -1;
        const chosen = field.options[index];
        if (chosen !== undefined) {
          onChange({ ...choices, [field.key]: chosen[0] });
        }
      }}
    >
      ${field.options.map(
        ([value, words]) =>
          html`<option .selected=${live(value === choices[field.key])}>${words}</option>`,
      )}
    </select>`;
}

/**
 * The dialog of an export as CSV: the separator, the decimal mark, the
 * encoding and how a missing value is written, then Cancel and Export….
 * The controller opens it as a modal dialog; Escape cancels.
 */
export function csvDialogView(props: CsvDialogProps): TemplateResult {
  const { choices } = props;
  return html`<dialog
    class=${classOf(styles, "dialog")}
    aria-labelledby="csv-heading"
    @cancel=${(event: Event) => {
      event.preventDefault();
      props.onAnswer(false);
    }}
  >
    ${
      choices === null
        ? nothing
        : html`<h2 id="csv-heading" class=${classOf(styles, "heading")}>Export as CSV</h2>
            <div class=${classOf(styles, "fields")}>
              ${select(SEPARATOR, choices, props.onChange)}
              ${select(
                {
                  ...DECIMAL,
                  options: DECIMAL.options.filter(([mark]) => props.decimalMarks.includes(mark)),
                },
                choices,
                props.onChange,
              )}
              ${select(ENCODING, choices, props.onChange)}
              ${select(MISSING, choices, props.onChange)}
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
                Export…
              </button>
            </div>`
    }
  </dialog>`;
}
