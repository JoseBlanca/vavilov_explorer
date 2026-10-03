import { nothing, render } from "lit-html";

import type { Answer, Connection } from "../../backend/connection.ts";
import type { BarMessage } from "../../state/barMessages.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow } from "../../state/description.ts";
import type { ColumnId, LevelCode, Revision } from "../../state/ids.ts";
import type { EditMode, Selected } from "../../state/message.ts";
import {
  addedCount,
  deletedMessage,
  pressedMessage,
  releasedMessage,
  removedCount,
} from "../../state/groupEdit.ts";
import type { EditTarget } from "../../state/groupEdit.ts";
import { rangeOf, removableGroups, singleOf, toggled } from "../../state/selectedGroups.ts";
import type { SelectedGroups } from "../../state/selectedGroups.ts";
import { groupRefusalMessage } from "../../state/groupMessages.ts";
import type { TypedFor } from "../../state/groupMessages.ts";
import { editTargetOf, groupsModel } from "../../state/groups.ts";
import type { GroupRow, GroupsModel } from "../../state/groups.ts";
import { answered } from "./answered.ts";
import { countText } from "./numbers.ts";
import { groupsPanelView } from "./groupsPanel.view.ts";
import type { GroupClick, GroupForm } from "./groupsPanel.view.ts";

/** The groups panel in its element. */
export interface GroupsPanel {
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
 * The groups panel: it shows the classifications and the groups of
 * the active one, and turns the user's choices into commands. + and − on
 * the selected group stay pressed until pressed again or Escape, and
 * the backend assigns the individuals that enter the selection meanwhile;
 * the information bar, through `tell`, says what pressing one did and when
 * it is released, however it was. Add group opens a field for the new
 * group's name, read with the region's decimal `mark`, and Edit group one
 * for the selected group's name and colour; the bar says why a name was
 * refused. Delete group deletes the selected group at once, and the bar
 * says how to undo it (docs/design.md, section 2.1).
 */
export function createGroupsPanel(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  mark: string,
  tell: (message: BarMessage) => void,
  report: (error: unknown) => void,
): GroupsPanel {
  const { state } = connection;
  let form: GroupForm = { kind: "closed" };
  let focusNext: FocusNext = null;
  /** The model last drawn, which names the groups of a refusal and of a release. */
  let drawn: GroupsModel | null = null;
  let pressed: Pressed | null = null;
  /**
   * The row last clicked without Shift, where a Shift-click's range starts,
   * with its classification, so that a range never starts from a row of
   * another one.
   */
  let anchor: { readonly column: ColumnId; readonly row: Selected } | null = null;
  /** Whether `destroy` ran, after which an answer that comes back draws nothing. */
  let destroyed = false;

  const closeForm = (): void => {
    form = { kind: "closed" };
  };

  /**
   * Selects `row` alone, or nothing when it was the one selected; a
   * Cmd-click or a Ctrl-click adds it to what is selected or takes it away;
   * a Shift-click selects every row from the last one clicked, the anchor,
   * to it.
   */
  const press = (row: GroupRow, click: GroupClick): void => {
    const active = state.active();
    if (active === null || drawn === null) {
      return;
    }
    let selected: SelectedGroups;
    switch (click) {
      case "alone":
        selected = row.isSelected && singleOf(active.selected) !== null ? [] : [row.selected];
        anchor = { column: active.column, row: row.selected };
        break;
      case "toggle":
        selected = toggled(active.selected, row.selected);
        anchor = { column: active.column, row: row.selected };
        break;
      case "range":
        selected = rangeOf(
          drawn.rows.map((other) => other.selected),
          anchor?.column === active.column ? anchor.row : null,
          row.selected,
        );
        break;
    }
    connection
      .selectGroups(active.column, selected)
      .then(answered("selecting groups", draw), report);
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
   * Presses `mode` on what is selected, or releases it when it is the one
   * pressed. The individuals selected that pressing it changes are counted
   * from the copy, which the command is made from.
   */
  const toggle = (mode: EditMode): void => {
    const now = edited();
    const active = state.active();
    if (now === null || active === null || drawn === null) {
      return;
    }
    const next = active.mode === mode ? null : mode;
    if (next === null) {
      connection
        .setEditMode(now.column, active.selected, null)
        .then(answered("releasing a button", draw), report);
      return;
    }
    const target = editTargetOf(drawn);
    if (target === null) {
      throw defect(`${next} pressed with nothing selected`);
    }
    let count: number;
    if (next === "add") {
      const single = singleOf(active.selected);
      if (single === null) {
        throw defect("+ pressed with other than one row selected");
      }
      count = addedCount(now.selection, now.codes, single);
    } else {
      count = removedCount(now.selection, now.codes, removableGroups(active.selected));
    }
    connection.setEditMode(now.column, active.selected, next).then((answer) => {
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
   * again, by Escape, or by another selection or another classification. A
   * load of another table releases it silently, since the bar starts
   * afresh. It runs on every draw from a current description, so that a
   * window that starts, or reloads, with a button pressed knows it.
   */
  const follow = (model: GroupsModel): void => {
    const project = state.project();
    const target = editTargetOf(model);
    if (project.kind !== "open" || model.mode === null || target === null) {
      if (pressed !== null && project.kind === "open" && project.loadedAt === pressed.loadedAt) {
        tell(releasedMessage(pressed.target, pressed.mode, countText));
      }
      pressed = null;
      return;
    }
    pressed = { loadedAt: project.loadedAt, target, mode: model.mode };
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
    if (active === null || active.selected.length === 0 || active.mode === null) {
      return;
    }
    event.preventDefault();
    connection
      .setEditMode(active.column, active.selected, null)
      .then(answered("releasing a button", draw), report);
  };

  /** The name of the group of `code` as the panel shows it, or `null` when the copy has none. */
  const groupName = (code: LevelCode): string | null =>
    drawn?.rows.find((row) => row.selected.kind === "group" && row.selected.code === code)?.name ??
    null;

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
      sent = connection.addGroup(sending.column, sending.text, mark);
      typedFor = { kind: "add" };
      focus = "addGroup";
    } else {
      sent = connection.editGroup(sending.column, sending.code, sending.text, sending.colour, mark);
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
      if (answer.error.kind === "groupRefused") {
        tell(groupRefusalMessage(answer.error, groupName, countText, typedFor));
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
  const deleteGroup = (row: GroupRow): void => {
    const active = state.active();
    if (active === null || row.selected.kind !== "group" || row.name === null) {
      throw defect("Delete group on a row that is not a group of the active classification");
    }
    const { name, count } = row;
    // Deleting the group releases + or − on it, which the bar's word of the
    // deletion says enough: the release is not told, whether the answer or
    // the change reaches the panel first. A refusal changes nothing, and
    // the next draw sees the button still pressed.
    pressed = null;
    connection.deleteGroup(active.column, row.selected.code).then((answer) => {
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
  const formFits = (model: GroupsModel): boolean => {
    switch (form.kind) {
      case "closed":
        return true;
      case "adding":
        return model.active === form.column;
      case "editing": {
        const { code } = form;
        return (
          model.active === form.column &&
          singleOf(model.selected)?.kind === "group" &&
          model.rows.some(
            (row) => row.isSelected && row.selected.kind === "group" && row.selected.code === code,
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
    const model = groupsModel(now.description, state.active(), state.codes, mark);
    if (!formFits(model)) {
      closeForm();
    }
    drawn = model;
    follow(model);
    const document = element.ownerDocument;
    const hadFocus = element.contains(document.activeElement);
    render(
      groupsPanelView({
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
          if (model.active === null || row.selected.kind !== "group") {
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
    throw defect("the groups panel in a document with no window");
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
