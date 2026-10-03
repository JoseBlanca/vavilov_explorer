import { nothing, render } from "lit-html";

import type { Connection } from "../../backend/connection.ts";
import type { BarMessage } from "../../state/barMessages.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow } from "../../state/description.ts";
import type { ColumnId, LevelCode, Revision } from "../../state/ids.ts";
import type { EditMode } from "../../state/message.ts";
import {
  addedCount,
  pressedMessage,
  releasedMessage,
  removedCount,
} from "../../state/populationEdit.ts";
import type { EditTarget } from "../../state/populationEdit.ts";
import { populationRefusalMessage } from "../../state/populationMessages.ts";
import { populationsModel } from "../../state/populations.ts";
import type { PopulationRow, PopulationsModel } from "../../state/populations.ts";
import { answered } from "../shared/answered.ts";
import { countText } from "../shared/numbers.ts";
import { populationsPanelView } from "./populationsPanel.view.ts";
import type { NameField } from "./populationsPanel.view.ts";

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

/** Where the focus goes once the panel is drawn, after the field of a name opened or closed. */
type FocusNext = "nameField" | "addGroup" | null;

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
 * group's name, read with the region's decimal `mark`, and the bar says why
 * a name was refused (docs/design.md, section 2.1).
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
  let nameField: NameField = { kind: "closed" };
  let focusNext: FocusNext = null;
  /** The model last drawn, which names the groups of a refusal and of a release. */
  let drawn: PopulationsModel | null = null;
  let pressed: Pressed | null = null;
  /** Whether `destroy` ran, after which an answer that comes back draws nothing. */
  let destroyed = false;

  const closeName = (): void => {
    nameField = { kind: "closed" };
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
   * Sends the name typed, once: a second Enter or Add while it is on its way
   * does nothing. The field closes when the group is added, or when the
   * command came after another table was loaded; it stays open, with what
   * was typed, when the name is refused.
   */
  const submitName = (): void => {
    if (nameField.kind !== "open") {
      return;
    }
    const sending: NameField = { ...nameField, kind: "sending" };
    nameField = sending;
    connection.addPopulation(sending.column, sending.text, mark).then((answer) => {
      const still = nameField === sending;
      if (answer.ok) {
        if (still) {
          closeName();
          focusNext = "addGroup";
        }
        draw();
        return;
      }
      if (still) {
        nameField = { ...sending, kind: "open" };
      }
      if (answer.error.kind === "populationRefused") {
        tell(populationRefusalMessage(answer.error, groupName, countText));
        return;
      }
      answered("adding a group", draw)(answer);
    }, report);
  };

  const draw = (): void => {
    if (destroyed) {
      return;
    }
    const now = description();
    if (now.kind === "none") {
      closeName();
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
    if (nameField.kind !== "closed" && model.active !== nameField.column) {
      closeName();
    }
    drawn = model;
    follow(model);
    const document = element.ownerDocument;
    const hadFocus = element.contains(document.activeElement);
    render(
      populationsPanelView({
        model,
        nameField,
        onChooseClassification: (column) => {
          connection
            .setActiveClassification(column)
            .then(answered("choosing the classification", draw), report);
        },
        onPress: press,
        onToggle: toggle,
        onOpenName: () => {
          if (model.active === null) {
            return;
          }
          nameField = { kind: "open", text: "", column: model.active };
          focusNext = "nameField";
          draw();
        },
        onTypeName: (text) => {
          if (nameField.kind === "open") {
            nameField = { ...nameField, text };
          }
        },
        onSubmitName: submitName,
        onCancelName: () => {
          closeName();
          focusNext = "addGroup";
          draw();
        },
      }),
      element,
    );
    moveFocus(hadFocus);
  };

  /**
   * Puts the focus where the field of a name that opened or closed sends it;
   * or, when the panel `hadFocus` and the control that held it was drawn
   * away, such as the + of a group an undo removed, on the selected row, or
   * else on Add group, or else on the classification, so that a user of the
   * keyboard keeps their place.
   */
  const moveFocus = (hadFocus: boolean): void => {
    const next = focusNext;
    focusNext = null;
    const selectors =
      next === "nameField"
        ? ["[data-name-field]"]
        : next === "addGroup"
          ? ["[data-add-group] button"]
          : hadFocus && !element.contains(element.ownerDocument.activeElement)
            ? ['li button[aria-pressed="true"]', "[data-add-group] button", "select"]
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
