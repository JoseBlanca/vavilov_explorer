import { html } from "lit-html";
import type { TemplateResult } from "lit-html";
import type { DirectiveResult } from "lit-html/directive.js";
import { keyed } from "lit-html/directives/keyed.js";
import { live } from "lit-html/directives/live.js";
import { repeat } from "lit-html/directives/repeat.js";

import { defect } from "../../state/defect.ts";
import { MAX_FILTER_TEXT } from "../../state/filter.ts";
import type { Operator } from "../../state/findCondition.ts";
import { isLevelCode } from "../../state/ids.ts";
import type { ColumnId, LevelCode } from "../../state/ids.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "./findBar.module.css";

/** A column the Column dropdown offers. */
export interface FindColumn {
  /** Its id. */
  readonly id: ColumnId;
  /** Its name, as the table's header shows it. */
  readonly name: string;
}

/**
 * The value of the condition: a field for a text or a number, the list of
 * the column's groups with the one chosen, or nothing for "is missing".
 */
export type FindValue =
  | {
      readonly kind: "text";
      readonly text: string;
      /**
       * Which field draws it: a new one each time the text is set from
       * outside, so that the field's own history of typing, which Undo
       * reads, holds only what the user typed in it.
       */
      readonly field: number;
    }
  | {
      readonly kind: "groups";
      readonly names: readonly string[];
      readonly chosen: LevelCode | null;
    }
  | { readonly kind: "none" };

/** What the find bar shows, and what the user's actions do. */
export interface FindBarProps {
  /** The columns of the table, IndividualID first. */
  readonly columns: readonly FindColumn[];
  /** The column searched, or `null` for any column. */
  readonly column: ColumnId | null;
  /** The operators the column offers, in their order. */
  readonly operators: readonly Operator[];
  /** The operator chosen. */
  readonly operator: Operator;
  /** The value of the condition. */
  readonly value: FindValue;
  /** Whether "Show rows that don't match" is ticked. */
  readonly notMatching: boolean;
  /** The user chose a column, or any. */
  readonly onColumn: (column: ColumnId | null) => void;
  /** The user chose an operator. */
  readonly onOperator: (operator: Operator) => void;
  /** The user typed in the field. */
  readonly onText: (text: string) => void;
  /** The user chose a group, or "Choose a group…" for none. */
  readonly onGroup: (code: LevelCode | null) => void;
  /** The user ticked or unticked "Show rows that don't match". */
  readonly onNotMatching: (notMatching: boolean) => void;
  /** The user asked to select the rows the table shows. */
  readonly onSelectShown: () => void;
}

/** The value of the option "Any column" in the Column dropdown. */
const ANY = "any";

/** The value of the option "Choose a group…" in the list of groups. */
const NO_GROUP = "none";

/**
 * Each operator as the dropdown writes it, words for texts and groups,
 * symbols for numbers, and as a screen reader says it (decided by the
 * owner on 4 October 2026).
 */
const OPERATOR_WORDS: Readonly<Record<Operator, { shown: string; said: string }>> = {
  contains: { shown: "contains", said: "contains" },
  is: { shown: "is", said: "is" },
  missing: { shown: "is missing", said: "is missing" },
  equal: { shown: "=", said: "equals" },
  less: { shown: "<", said: "less than" },
  atMost: { shown: "≤", said: "at most" },
  greater: { shown: ">", said: "greater than" },
  atLeast: { shown: "≥", said: "at least" },
};

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
 * The operator of the option `value`, one of `operators`.
 *
 * @throws A defect for a value no option has.
 */
function chosenOperator(value: string, operators: readonly Operator[]): Operator {
  const chosen = operators.find((operator) => operator === value);
  if (chosen === undefined) {
    throw defect(`an operator ${value} chosen in the find bar, not offered`);
  }
  return chosen;
}

/**
 * The group of the option `value` of the list of groups, `null` for none.
 *
 * @throws A defect for a value that is no group's code.
 */
function chosenGroup(value: string, names: readonly string[]): LevelCode | null {
  if (value === NO_GROUP) {
    return null;
  }
  const code = Number(value);
  if (!isLevelCode(code) || code >= names.length) {
    throw defect(`a group ${value} chosen in the find bar, of ${String(names.length)} groups`);
  }
  return code;
}

/** The value's control: the field, the list of groups, or the field greyed out. */
function valueView(props: FindBarProps): TemplateResult | DirectiveResult {
  const { value } = props;
  if (value.kind === "groups") {
    return html`<select
      class=${classOf(styles, "select")}
      aria-label="Group"
      @change=${(event: Event) => {
        if (event.target instanceof HTMLSelectElement) {
          props.onGroup(chosenGroup(event.target.value, value.names));
        }
      }}
    >
      <option value=${NO_GROUP} .selected=${live(value.chosen === null)}>Choose a group…</option>
      ${repeat(
        value.names,
        (_, code) => code,
        (name, code) =>
          html`<option value=${String(code)} .selected=${live(value.chosen === code)}>
            ${name}
          </option>`,
      )}
    </select>`;
  }
  return keyed(
    value.kind === "text" ? value.field : -1,
    html`<input
      type="search"
      class=${classOf(styles, "text")}
      aria-label="Find"
      maxlength=${String(MAX_FILTER_TEXT)}
      ?disabled=${value.kind === "none"}
      .value=${live(value.kind === "text" ? value.text : "")}
      @input=${(event: Event) => {
        if (event.target instanceof HTMLInputElement) {
          props.onText(event.target.value);
        }
      }}
    />`,
  );
}

/**
 * The find bar above the table (docs/design.md, section 2.1), read as a
 * sentence, "Find height ≥ 1.5": the Column dropdown, "Any column" and
 * then every column; the operators of the column chosen; the value, a
 * field, the list of the column's groups for "is" on a category or a
 * column of countries, or the field greyed out for "is missing"; the
 * checkbox "Show rows that don't match"; and the button "Select shown
 * rows", which makes the rows the table shows the selection.
 */
export function findBarView(props: FindBarProps): TemplateResult {
  return html`<div class=${classOf(styles, "bar")} role="search" aria-label="Find in the table">
    <div class=${classOf(styles, "field")}>
      <span aria-hidden="true">Find</span>
      <select
        class=${classOf(styles, "select")}
        aria-label="Column"
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
      <select
        class=${classOf(styles, "select")}
        aria-label="Operator"
        @change=${(event: Event) => {
          if (event.target instanceof HTMLSelectElement) {
            props.onOperator(chosenOperator(event.target.value, props.operators));
          }
        }}
      >
        ${repeat(
          props.operators,
          (operator) => operator,
          (operator) =>
            html`<option
              value=${operator}
              aria-label=${OPERATOR_WORDS[operator].said}
              .selected=${live(props.operator === operator)}
            >
              ${OPERATOR_WORDS[operator].shown}
            </option>`,
        )}
      </select>
      ${valueView(props)}
    </div>
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
    <button type="button" class=${classOf(styles, "action")} @click=${props.onSelectShown}>
      Select shown rows
    </button>
  </div>`;
}
