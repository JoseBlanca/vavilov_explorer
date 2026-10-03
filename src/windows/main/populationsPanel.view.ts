import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { repeat } from "lit-html/directives/repeat.js";
import { styleMap } from "lit-html/directives/style-map.js";

import { defect } from "../../state/defect.ts";
import type { ColumnId } from "../../state/ids.ts";
import type { EditMode, Selected } from "../../state/message.ts";
import type { PopulationRow, PopulationsModel } from "../../state/populations.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "./populationsPanel.module.css";

/**
 * The field where the name of a new group is typed: closed, or open on a
 * classification with what is typed, or sending it, when a second Enter
 * does nothing.
 */
export type NameField =
  | { readonly kind: "closed" }
  | { readonly kind: "open" | "sending"; readonly text: string; readonly column: ColumnId };

/** What the populations panel shows, and what the user can do there. */
export interface PopulationsPanelProps {
  /** The classifications, the active one, and its rows. */
  readonly model: PopulationsModel;
  /** The field of a new group's name. */
  readonly nameField: NameField;
  /** The user chose an active classification, or none. */
  readonly onChooseClassification: (column: ColumnId | null) => void;
  /** The user pressed a row. */
  readonly onPress: (row: PopulationRow) => void;
  /** The user pressed + or − on the selected row, to press it or to release it. */
  readonly onToggle: (row: PopulationRow, mode: EditMode) => void;
  /** The user pressed Add group. */
  readonly onOpenName: () => void;
  /** The user typed in the field of the new group's name. */
  readonly onTypeName: (text: string) => void;
  /** The user asked for the group typed, with Enter or Add. */
  readonly onSubmitName: () => void;
  /** The user gave up the new group, with Escape or Cancel. */
  readonly onCancelName: () => void;
}

/** A button of the panel that may be greyed out, with what its tooltip says. */
interface Action {
  /** Its name, which a screen reader reads and a test finds it by. */
  readonly label: string;
  /** Why it does nothing now, or `null` when it acts. */
  readonly reason: string | null;
  /** Whether it is pressed, for a button that stays pressed; `null` for one that does not. */
  readonly pressed: boolean | null;
}

const COUNT = new Intl.NumberFormat();

function keyOf(selected: Selected): string {
  return selected.kind === "unassigned" ? "unassigned" : String(selected.code);
}

/** What + on `row` does, pressed or not while `mode` is pressed. */
function addAction(row: PopulationRow, mode: EditMode | null): Action {
  const label = row.name === null ? "Make selected unassigned" : `Add selected to ${row.name}`;
  return { label, reason: null, pressed: mode === "add" };
}

/** What − on `row` does, pressed or not while `mode` is pressed, and why it does nothing on the unassigned. */
function removeAction(row: PopulationRow, mode: EditMode | null): Action {
  if (row.name === null) {
    return {
      label: "Remove selected",
      reason: "Unassigned individuals are in no group to remove them from.",
      pressed: false,
    };
  }
  return { label: `Remove selected from ${row.name}`, reason: null, pressed: mode === "remove" };
}

/** The tooltip of `action`: what it does, why it does nothing, or how to release it. */
function tooltipOf(action: Action, symbol: string): string {
  if (action.reason !== null) {
    return action.reason;
  }
  return action.pressed === true
    ? `${action.label}: on. Press ${symbol} again, or Escape, to stop.`
    : action.label;
}

/**
 * A button that says what it does in its tooltip, or why it does nothing.
 * One that does nothing is greyed out with `aria-disabled` rather than
 * `disabled`, so that it keeps its tooltip and its place in the order of Tab,
 * where a screen reader reads the reason. One that stays pressed says so
 * with `aria-pressed`.
 */
function actionButton(
  action: Action,
  classNames: readonly string[],
  content: string,
  onClick: () => void,
): TemplateResult {
  return html`<button
    type="button"
    class=${classNames.map((name) => classOf(styles, name)).join(" ")}
    aria-label=${action.label}
    title=${tooltipOf(action, content)}
    aria-disabled=${action.reason === null ? "false" : "true"}
    aria-pressed=${action.pressed === null ? nothing : String(action.pressed)}
    @click=${() => {
      if (action.reason === null) {
        onClick();
      }
    }}
  >
    ${content}
  </button>`;
}

function rowView(props: PopulationsPanelProps, row: PopulationRow): TemplateResult {
  return html`<li class=${classOf(styles, "item")}>
    <button
      type="button"
      class=${classOf(styles, "row")}
      aria-pressed=${row.isSelected ? "true" : "false"}
      @click=${() => {
        props.onPress(row);
      }}
    >
      <span
        class=${classOf(styles, row.colour === null ? "swatchNone" : "swatch")}
        style=${styleMap(row.colour === null ? {} : { backgroundColor: row.colour })}
        aria-hidden="true"
      ></span>
      <span class=${classOf(styles, "name")}>${row.name ?? "Unassigned"}</span>
      <span class=${classOf(styles, "count")}>${COUNT.format(row.count)}</span>
    </button>
    ${
      row.isSelected
        ? html`${actionButton(addAction(row, props.model.mode), ["edit", "add"], "+", () => {
            props.onToggle(row, "add");
          })}${actionButton(removeAction(row, props.model.mode), ["edit", "remove"], "−", () => {
            props.onToggle(row, "remove");
          })}`
        : nothing
    }
  </li>`;
}

function nameFieldView(props: PopulationsPanelProps, text: string): TemplateResult {
  return html`<form
    class=${classOf(styles, "nameForm")}
    @submit=${(event: Event) => {
      event.preventDefault();
      props.onSubmitName();
    }}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onCancelName();
      }
    }}
  >
    <label class=${classOf(styles, "field")}>
      <span>Name of the new group</span>
      <input
        class=${classOf(styles, "text")}
        data-name-field
        autocomplete="off"
        spellcheck="false"
        maxlength=${props.model.nameLimit ?? nothing}
        .value=${live(text)}
        @input=${(event: Event) => {
          if (event.target instanceof HTMLInputElement) {
            props.onTypeName(event.target.value);
          }
        }}
      />
    </label>
    <div class=${classOf(styles, "buttons")}>
      <button type="submit" class=${classOf(styles, "action")}>Add</button>
      <button type="button" class=${classOf(styles, "action")} @click=${props.onCancelName}>
        Cancel
      </button>
    </div>
  </form>`;
}

function addGroupView(props: PopulationsPanelProps): TemplateResult {
  const { model } = props;
  if (model.activeName === null) {
    throw defect("Add group drawn with no active classification");
  }
  const action: Action = {
    pressed: null,
    label: "Add group",
    reason: model.takesNewPopulations
      ? null
      : `“${model.activeName}” has both TRUE and FALSE, and takes no other group.`,
  };
  return html`<div class=${classOf(styles, "buttons")} data-add-group>
    ${actionButton(action, ["action"], "Add group", props.onOpenName)}
  </div>`;
}

/** The populations panel of the main window (docs/design.md, section 2.1). */
export function populationsPanelView(props: PopulationsPanelProps): TemplateResult {
  const { model } = props;
  return html`<section class=${classOf(styles, "panel")} aria-labelledby="populations-heading">
    <h2 id="populations-heading" class=${classOf(styles, "heading")}>Populations</h2>
    <label class=${classOf(styles, "field")}>
      <span>Classification column</span>
      <select
        class=${classOf(styles, "select")}
        @change=${(event: Event) => {
          const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
          props.onChooseClassification(
            model.classifications.find((choice) => String(choice.column) === value)?.column ?? null,
          );
        }}
      >
        <option value="" .selected=${live(model.active === null)}>None</option>
        ${repeat(
          model.classifications,
          (choice) => choice.column,
          (choice) =>
            html`<option
              value=${String(choice.column)}
              .selected=${live(choice.column === model.active)}
            >
              ${choice.name}
            </option>`,
        )}
      </select>
    </label>
    ${
      model.rows.length === 0
        ? nothing
        : html`<ul class=${classOf(styles, "list")}>
            ${repeat(
              model.rows,
              // Of the classification too, so that a population of another
              // with the same code is a new row, not the old one relabelled.
              (row) => `${String(model.active)}:${keyOf(row.selected)}:${row.name ?? ""}`,
              (row) => rowView(props, row),
            )}
          </ul>`
    }
    ${
      model.active === null
        ? nothing
        : props.nameField.kind !== "closed"
          ? nameFieldView(props, props.nameField.text)
          : addGroupView(props)
    }
  </section>`;
}
