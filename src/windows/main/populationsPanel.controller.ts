import { nothing, render } from "lit-html";

import type { Answer, Connection } from "../../backend/connection.ts";
import type { BarMessage } from "../../state/barMessages.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow } from "../../state/description.ts";
import type { ColumnId, LevelCode, Revision } from "../../state/ids.ts";
import type { EditMode } from "../../state/message.ts";
import {
  addedCount,
  deletedMessage,
  pressedMessage,
  releasedMessage,
  removedCount,
} from "../../state/populationEdit.ts";
import type { EditTarget } from "../../state/populationEdit.ts";
import { populationRefusalMessage } from "../../state/populationMessages.ts";
import type { TypedFor } from "../../state/populationMessages.ts";
import { populationsModel } from "../../state/populations.ts";
import type { PopulationRow, PopulationsModel } from "../../state/populations.ts";
import { answered } from "../shared/answered.ts";
import { countText } from "../shared/numbers.ts";
import { populationsPanelView } from "./populationsPanel.view.ts";
import type { GroupForm } from "./populationsPanel.view.ts";

/** The populations panel in its element. */
export interface PopulationsPanel {
  /** Draws the panel again, when the description of the table has changed. */
  readonly redraw: () => void;
  /** Unsubscribes and empties the element. */
  readonly destroy: () => void;
}

/** What + and − act on: the active classification, the selection and its codes. */
interface Edited {
  readonly column: ColumnId;
  readonly selection: Uint8Array;
  readonly codes: Uint16Array;
}

/** Where the focus goes once the panel is drawn, after a form opened or closed. */
type FocusNext = "nameField" | "addGroup" | "editGroup" | null;

/** The button pressed as the panel last saw it, so that the bar can say when it is released. */
interface Pressed {
  /** The revision of the load of the table it was pressed on. */
  readonly loadedAt: Revision;
  readonly target: EditTarget;
  readonly mode: EditMode;
}

/**
 * The populations panel: it shows the classifications and the populations of
 * the active one, and turns the user's choices into commands. + and − on
 * the selected population stay pressed until pressed again or Escape, and
 * the backend assigns the individuals that enter the selection meanwhile;
 * the information bar, through `tell`, says what pressing one did and when
 * it is released, however it was. Add group opens a field for the new
 * group's name, read with the region's decimal `mark`, and Edit group one
 * for the selected group's name and colour; the bar says why a name was
 * refused. Delete group deletes the selected group at once, and the bar
 * says how to undo it (docs/design.md, section 2.1).
 */
export function createPopulationsPanel(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  mark: string,
  tell: (message: BarMessage) => void,
  report: (error: unknown) => void,
): PopulationsPanel {
  const { state } = connection;
  let form: GroupForm = { kind: "closed" };
  let focusNext: FocusNext = null;
  /** The model last drawn, which names the groups of a refusal and of a release. */
  let drawn: PopulationsModel | null = null;
  let pressed: Pressed | null = null;
  /** Whether `destroy` ran, after which an answer that comes back draws nothing. */
  let destroyed = false;

  const closeForm = (): void => {
    form = { kind: "closed" };
  };

  const press = (row: PopulationRow): void => {
    const active = state.active();
    if (active === null) {
      return;
    }
    connection
      .selectPopulation(active.column, row.isSelected ? null : row.selected)
      .then(answered("selecting a population", draw), report);
  };

  /** The active classification, the selection and its codes, or `null` with none active. */
  const edited = (): Edited | null => {
    const active = state.active();
    if (active === null) {
      return null;
    }
    const selection = state.selection();
    const codes = state.codes(active.column);
    if (selection === null || codes === null) {
      throw defect(
        `+ or − on column ${String(active.column)} with ${selection === null ? "no selection" : "no codes"} in the copy`,
      );
    }
    return { column: active.column, selection, codes };
  };

  /**
   * Presses `mode` on `row`, or releases it when it is the one pressed. The
   * individuals selected that pressing it changes are counted from the copy,
   * which the command is made from.
   */
  const toggle = (row: PopulationRow, mode: EditMode): void => {
    const now = edited();
    if (now === null) {
      return;
    }
    const next = state.active()?.mode === mode ? null : mode;
    if (next === null) {
      connection
        .setEditMode(now.column, row.selected, null)
        .then(answered("releasing a button", draw), report);
      return;
    }
    const target = targetOfRow(row);
    let count: number;
    if (next === "add") {
      count = addedCount(now.selection, now.codes, row.selected);
    } else if (row.selected.kind === "population") {
      count = removedCount(now.selection, now.codes, row.selected.code);
    } else {
      throw defect("− pressed on the unassigned individuals");
    }
    connection.setEditMode(now.column, row.selected, next).then((answer) => {
      if (answer.ok && answer.value === "applied") {
        tell(pressedMessage(count, target, next, countText));
        return;
      }
      answered("pressing a button", draw)(answer);
    }, report);
  };

  /**
   * Follows the button pressed in the copy, as `model` draws it, from any
   * window or command, and tells the bar when it is released: by pressing it
   * again, by Escape, or by another selection for editing or another
   * classification. A load of another table releases it silently, since the
   * bar starts afresh. It runs on every draw from a current description, so
   * that a window that starts, or reloads, with a button pressed knows it.
   */
  const follow = (model: PopulationsModel): void => {
    const project = state.project();
    const selectedRow = model.rows.find((row) => row.isSelected) ?? null;
    if (project.kind !== "open" || model.mode === null || selectedRow === null) {
      if (pressed !== null && project.kind === "open" && project.loadedAt === pressed.loadedAt) {
        tell(releasedMessage(pressed.target, pressed.mode));
      }
      pressed = null;
      return;
    }
    pressed = { loadedAt: project.loadedAt, target: targetOfRow(selectedRow), mode: model.mode };
  };

  /**
   * Releases the button pressed on Escape, unless the key is for a field
   * being typed in or a dialog, which take it themselves.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented || takesEscape(event.target)) {
      return;
    }
    if (element.ownerDocument.querySelector("dialog[open]") !== null) {
      return;
    }
    const active = state.active();
    const selected = active?.selected ?? null;
    if (active === null || selected === null || active.mode === null) {
      return;
    }
    event.preventDefault();
    connection
      .setEditMode(active.column, selected, null)
      .then(answered("releasing a button", draw), report);
  };

  /** The name of the group of `code` as the panel shows it, or `null` when the copy has none. */
  const groupName = (code: LevelCode): string | null =>
    drawn?.rows.find((row) => row.selected.kind === "population" && row.selected.code === code)
      ?.name ?? null;

  /**
   * Sends what the form holds, once: a second Enter while it is on its way
   * does nothing. The form closes when the group is added or edited, or
   * when the command came after another table was loaded or the groups
   * changed; it stays open, with what was typed, when the name is refused.
   */
  const submitForm = (): void => {
    if (form.kind === "closed" || form.sending) {
      return;
    }
    const sending: GroupForm = { ...form, sending: true };
    form = sending;
    let sent: Promise<Answer>;
    let typedFor: TypedFor;
    let focus: FocusNext;
    if (sending.kind === "adding") {
      sent = connection.addPopulation(sending.column, sending.text, mark);
      typedFor = { kind: "add" };
      focus = "addGroup";
    } else {
      sent = connection.editPopulation(
        sending.column,
        sending.code,
        sending.text,
        sending.colour,
        mark,
      );
      typedFor = { kind: "edit", name: sending.name };
      focus = "editGroup";
    }
    sent.then((answer) => {
      const still = form === sending;
      if (answer.ok) {
        if (still) {
          closeForm();
          focusNext = focus;
        }
        draw();
        return;
      }
      if (still) {
        form = { ...sending, sending: false };
      }
      if (answer.error.kind === "populationRefused") {
        tell(populationRefusalMessage(answer.error, groupName, countText, typedFor));
        return;
      }
      answered(typedFor.kind === "add" ? "adding a group" : "editing a group", draw)(answer);
    }, report);
  };

  /**
   * Deletes the group of `row`, tells the bar how many of its individuals,
   * counted from the copy, are unassigned now, and puts the focus on Add
   * group.
   */
  const deleteGroup = (row: PopulationRow): void => {
    const active = state.active();
    if (active === null || row.selected.kind !== "population" || row.name === null) {
      throw defect("Delete group on a row that is not a group of the active classification");
    }
    const { name, count } = row;
    // Deleting the group releases + or − on it, which the bar's word of the
    // deletion says enough: the release is not told, whether the answer or
    // the change reaches the panel first. A refusal changes nothing, and
    // the next draw sees the button still pressed.
    pressed = null;
    connection.deletePopulation(active.column, row.selected.code).then((answer) => {
      if (answer.ok && answer.value === "applied") {
        tell(deletedMessage(name, count, countText));
        // Delete group is gone with the group: the focus goes to Add group.
        focusNext = "addGroup";
        draw();
        return;
      }
      answered("deleting a group", draw)(answer);
    }, report);
  };

  /** Whether the form is on what the panel shows: its classification, and the group it edits selected. */
  const formFits = (model: PopulationsModel): boolean => {
    switch (form.kind) {
      case "closed":
        return true;
      case "adding":
        return model.active === form.column;
      case "editing": {
        const { code } = form;
        return (
          model.active === form.column &&
          model.rows.some(
            (row) =>
              row.isSelected && row.selected.kind === "population" && row.selected.code === code,
          )
        );
      }
    }
  };

  const draw = (): void => {
    if (destroyed) {
      return;
    }
    const now = description();
    if (now.kind === "none") {
      closeForm();
      drawn = null;
      pressed = null;
      render(nothing, element);
      return;
    }
    if (now.kind === "behind") {
      // The description of the copy's shape is on its way, and draws again.
      return;
    }
    const model = populationsModel(now.description, state.active(), state.codes, mark);
    if (!formFits(model)) {
      closeForm();
    }
    drawn = model;
    follow(model);
    const document = element.ownerDocument;
    const hadFocus = element.contains(document.activeElement);
    render(
      populationsPanelView({
        model,
        form,
        onChooseClassification: (column) => {
          connection
            .setActiveClassification(column)
            .then(answered("choosing the classification", draw), report);
        },
        onPress: press,
        onToggle: toggle,
        onOpenAdd: () => {
          if (model.active === null) {
            return;
          }
          form = { kind: "adding", sending: false, column: model.active, text: "" };
          focusNext = "nameField";
          draw();
        },
        onOpenEdit: (row) => {
          if (model.active === null || row.selected.kind !== "population") {
            return;
          }
          if (row.name === null || row.colour === null) {
            throw defect(`the group ${String(row.selected.code)} with no name or colour`);
          }
          form = {
            kind: "editing",
            sending: false,
            column: model.active,
            code: row.selected.code,
            name: row.name,
            text: row.name,
            colour: row.colour,
          };
          focusNext = "nameField";
          draw();
        },
        onDelete: deleteGroup,
        onTypeName: (text) => {
          if (form.kind !== "closed" && !form.sending) {
            form = { ...form, text };
          }
        },
        onChooseColour: (colour) => {
          if (form.kind === "editing" && !form.sending) {
            form = { ...form, colour };
          }
        },
        onSubmitForm: submitForm,
        onCancelForm: () => {
          focusNext = form.kind === "editing" ? "editGroup" : "addGroup";
          closeForm();
          draw();
        },
      }),
      element,
    );
    moveFocus(hadFocus);
  };

  /**
   * Puts the focus where a form that opened or closed sends it;
   * or, when the panel `hadFocus` and the control that held it was drawn
   * away, such as the + of a group an undo removed, on the selected row, or
   * else on Add group, or else on the classification, so that a user of the
   * keyboard keeps their place.
   */
  const moveFocus = (hadFocus: boolean): void => {
    const next = focusNext;
    focusNext = null;
    const add = '[data-group-action="add"]';
    const selectors =
      next === "nameField"
        ? ["[data-name-field]"]
        : next === "addGroup"
          ? [add]
          : next === "editGroup"
            ? ['[data-group-action="edit"]', add]
            : hadFocus && !element.contains(element.ownerDocument.activeElement)
              ? ['li button[aria-pressed="true"]', add, "select"]
              : [];
    for (const selector of selectors) {
      const target = element.querySelector(selector);
      if (target instanceof HTMLElement) {
        target.focus();
        return;
      }
    }
  };

  const view = element.ownerDocument.defaultView;
  if (view === null) {
    throw defect("the populations panel in a document with no window");
  }
  view.addEventListener("keydown", onKeyDown);
  const unsubscribes = (["classification", "codes", "table"] as const).map((aspect) =>
    state.subscribe(aspect, draw),
  );
  draw();
  return {
    redraw: draw,
    destroy: () => {
      destroyed = true;
      view.removeEventListener("keydown", onKeyDown);
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      render(nothing, element);
    },
  };
}

/**
 * What `row` is as the bar names it.
 *
 * @throws A defect for the row of a population with no name, which only the
 * unassigned individuals' has.
 */
function targetOfRow(row: PopulationRow): EditTarget {
  if (row.selected.kind === "unassigned") {
    return { kind: "unassigned" };
  }
  if (row.name === null) {
    throw defect(`a row of the population ${String(row.selected.code)} with no name`);
  }
  return { kind: "population", code: row.selected.code, name: row.name };
}

/** The types of `<input>` the user types text into, where Escape belongs to the field. */
const TEXT_INPUTS: ReadonlySet<string> = new Set([
  "text",
  "search",
  "number",
  "email",
  "url",
  "tel",
  "password",
]);

/**
 * Whether `target` takes Escape itself: a field the user types text into.
 * A checkbox, a button or a closed dropdown does not, so Escape there
 * releases + or −.
 */
function takesEscape(target: EventTarget | null): boolean {
  return (
    (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
