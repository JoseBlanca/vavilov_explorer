import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { repeat } from "lit-html/directives/repeat.js";
import { styleMap } from "lit-html/directives/style-map.js";

import { defect } from "../../state/defect.ts";
import type { ColumnId, LevelCode } from "../../state/ids.ts";
import type { EditMode, Selected } from "../../state/message.ts";
import { targetWords } from "../../state/groupEdit.ts";
import { colourChoices, editTargetOf } from "../../state/groups.ts";
import { singleOf } from "../../state/selectedGroups.ts";
import type { GroupRow, GroupsModel } from "../../state/groups.ts";
import { classOf } from "./classOf.ts";
import styles from "./groupsPanel.module.css";

/**
 * The form below the groups: closed, or adding a group to a
 * classification, or editing the group of `code`, named `name` when the
 * form opened, with the name typed and the colour chosen. While `sending`,
 * a second Enter does nothing.
 */
export type GroupForm =
  | { readonly kind: "closed" }
  | {
      readonly kind: "adding";
      readonly sending: boolean;
      readonly column: ColumnId;
      readonly text: string;
    }
  | {
      readonly kind: "editing";
      readonly sending: boolean;
      readonly column: ColumnId;
      readonly code: LevelCode;
      readonly name: string;
      readonly text: string;
      readonly colour: string;
    };

/**
 * How a group's row was clicked: alone, with Cmd or Ctrl to add it or take
 * it away, or with Shift to select the range from the last row clicked.
 */
export type GroupClick = "alone" | "toggle" | "range";

/** What the groups panel shows, and what the user can do there. */
export interface GroupsPanelProps {
  /** The classifications, the active one, and its rows. */
  readonly model: GroupsModel;
  /** The form of a group added or edited. */
  readonly form: GroupForm;
  /** The user chose an active classification, or none. */
  readonly onChooseClassification: (column: ColumnId | null) => void;
  /** The user pressed a row. */
  readonly onPress: (row: GroupRow, click: GroupClick) => void;
  /** The user pressed + or − on the selected row, to press it or to release it. */
  readonly onToggle: (mode: EditMode) => void;
  /** The user pressed Add group. */
  readonly onOpenAdd: () => void;
  /** The user pressed Edit group on the selected group's `row`. */
  readonly onOpenEdit: (row: GroupRow) => void;
  /** The user pressed Delete group on the selected group's `row`. */
  readonly onDelete: (row: GroupRow) => void;
  /** The user typed in the field of the group's name. */
  readonly onTypeName: (text: string) => void;
  /** The user chose a colour for the group edited, as CSS writes it. */
  readonly onChooseColour: (colour: string) => void;
  /** The user asked for what the form holds, with Enter, Add or Save. */
  readonly onSubmitForm: () => void;
  /** The user gave up the form, with Escape or Cancel. */
  readonly onCancelForm: () => void;
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
function addAction(row: GroupRow, mode: EditMode | null): Action {
  const label = row.name === null ? "Make selected unassigned" : `Add selected to ${row.name}`;
  return { label, reason: null, pressed: mode === "add" };
}

/**
 * What − does, pressed or not, on what `model` has selected: the one group,
 * or every group of several; and why it does nothing on the unassigned
 * individuals alone.
 */
function removeAction(model: GroupsModel): Action {
  const target = editTargetOf(model);
  if (target === null) {
    throw defect("− drawn with nothing selected");
  }
  if (target.kind === "unassigned") {
    return {
      label: "Remove selected",
      reason: "Unassigned individuals are in no group to remove them from.",
      pressed: false,
    };
  }
  const names = targetWords(target, (value) => COUNT.format(value));
  return { label: `Remove selected from ${names}`, reason: null, pressed: model.mode === "remove" };
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
 * with `aria-pressed`. `key`, when given, marks it for the controller to
 * put the focus on.
 */
function actionButton(
  action: Action,
  classNames: readonly string[],
  content: string,
  onClick: () => void,
  key: string | null,
): TemplateResult {
  return html`<button
    type="button"
    data-group-action=${key ?? nothing}
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

function rowView(props: GroupsPanelProps, row: GroupRow): TemplateResult {
  return html`<li class=${classOf(styles, "item")}>
    <button
      type="button"
      class=${classOf(styles, "row")}
      aria-pressed=${row.isSelected ? "true" : "false"}
      @mousedown=${(event: MouseEvent) => {
        // A Shift-click selects a range, and must not select the text of
        // the rows between.
        if (event.shiftKey) {
          event.preventDefault();
        }
      }}
      @click=${(event: MouseEvent) => {
        props.onPress(
          row,
          event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "alone",
        );
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
      row.showsPlus
        ? actionButton(
            addAction(row, props.model.mode),
            ["edit", "add"],
            "+",
            () => {
              props.onToggle("add");
            },
            null,
          )
        : nothing
    }${
      row.showsMinus
        ? actionButton(
            removeAction(props.model),
            ["edit", "remove"],
            "−",
            () => {
              props.onToggle("remove");
            },
            null,
          )
        : nothing
    }
  </li>`;
}

/** The field of a group's name, labelled `label`, with what was typed. */
function nameInput(props: GroupsPanelProps, label: string, text: string): TemplateResult {
  return html`<label class=${classOf(styles, "field")}>
    <span>${label}</span>
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
  </label>`;
}

/** A form of the panel, with its fields and its buttons, which Escape gives up. */
function formView(
  props: GroupsPanelProps,
  label: string,
  fields: TemplateResult,
  submit: string,
): TemplateResult {
  return html`<form
    class=${classOf(styles, "groupForm")}
    aria-label=${label}
    @submit=${(event: Event) => {
      event.preventDefault();
      props.onSubmitForm();
    }}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onCancelForm();
      }
    }}
  >
    ${fields}
    <div class=${classOf(styles, "buttons")}>
      <button type="submit" class=${classOf(styles, "action")}>${submit}</button>
      <button type="button" class=${classOf(styles, "action")} @click=${props.onCancelForm}>
        Cancel
      </button>
    </div>
  </form>`;
}

/** The colours the group edited can take, one chosen, as radio buttons. */
function colourField(props: GroupsPanelProps, code: LevelCode, chosen: string): TemplateResult {
  return html`<fieldset class=${classOf(styles, "colours")}>
    <legend class=${classOf(styles, "legend")}>Colour</legend>
    <div class=${classOf(styles, "colourGrid")}>
      ${colourChoices(props.model.rows, code, (value) => COUNT.format(value)).map(
        (choice) =>
          html`<label class=${classOf(styles, "colourChoice")} title=${choice.label}>
            <input
              class=${classOf(styles, "colourInput")}
              type="radio"
              name="group-colour"
              value=${choice.colour}
              aria-label=${choice.label}
              .checked=${live(choice.colour === chosen)}
              @change=${() => {
                props.onChooseColour(choice.colour);
              }}
            />
            <span
              class=${classOf(styles, "colourSwatch")}
              style=${styleMap({ backgroundColor: choice.colour })}
              aria-hidden="true"
            ></span>
          </label>`,
      )}
    </div>
  </fieldset>`;
}

/** Add group, and Edit group and Delete group when a group is selected. */
function groupActionsView(props: GroupsPanelProps): TemplateResult {
  const { model } = props;
  if (model.activeName === null) {
    throw defect("Add group drawn with no active classification");
  }
  const add: Action = {
    pressed: null,
    label: "Add group",
    reason: model.takesNewGroups
      ? null
      : `“${model.activeName}” has both TRUE and FALSE, and takes no other group.`,
  };
  // Edit group and Delete group act on one group alone.
  const single = singleOf(model.selected);
  const selected =
    single?.kind === "group"
      ? model.rows.find((row) => row.selected.kind === "group" && row.selected.code === single.code)
      : undefined;
  const name = selected?.name ?? null;
  return html`<div class=${classOf(styles, "buttons")} data-group-actions>
    ${actionButton(add, ["action"], "Add group", props.onOpenAdd, "add")}
    ${
      selected === undefined || name === null
        ? nothing
        : html`${actionButton(
            { pressed: null, label: `Edit group ${name}`, reason: null },
            ["action"],
            "Edit group",
            () => {
              props.onOpenEdit(selected);
            },
            "edit",
          )}${actionButton(
            { pressed: null, label: `Delete group ${name}`, reason: null },
            ["action"],
            "Delete group",
            () => {
              props.onDelete(selected);
            },
            "delete",
          )}`
    }
  </div>`;
}

/** The form open below the groups, or the buttons that open one. */
function belowGroupsView(props: GroupsPanelProps): TemplateResult {
  const { form } = props;
  switch (form.kind) {
    case "closed":
      return groupActionsView(props);
    case "adding":
      return formView(
        props,
        "Add group",
        nameInput(props, "Name of the new group", form.text),
        "Add",
      );
    case "editing":
      return formView(
        props,
        `Edit group ${form.name}`,
        html`${nameInput(props, "Name of the group", form.text)}${colourField(
          props,
          form.code,
          form.colour,
        )}`,
        "Save",
      );
  }
}

/** The groups panel of the main window (docs/design.md, section 2.1). */
export function groupsPanelView(props: GroupsPanelProps): TemplateResult {
  const { model } = props;
  return html`<section class=${classOf(styles, "panel")} aria-labelledby="groups-heading">
    <h2 id="groups-heading" class=${classOf(styles, "heading")}>Groups</h2>
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
              // Of the classification too, so that a group of another
              // with the same code is a new row, not the old one relabelled.
              (row) => `${String(model.active)}:${keyOf(row.selected)}:${row.name ?? ""}`,
              (row) => rowView(props, row),
            )}
          </ul>`
    }
    ${model.active === null ? nothing : belowGroupsView(props)}
  </section>`;
}
