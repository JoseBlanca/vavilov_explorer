// Undo and Redo of the typing in a text field, by the keyboard and by the
// menu (docs/design.md, sections 2.1 and 10).
//
// Each field keeps its own history of the values the user typed. WebKit and
// Chromium keep one history for the whole page, so their own undo, reached
// with document.execCommand, takes back the last typing in any field and
// moves the focus there: Undo in a cell being edited took back the find
// field's text and lost the filter (the review of 4 October 2026).

import { platformOf, undoKeyOf } from "../../state/undoKeys.ts";

/** A text field the user types into. */
type TextField = HTMLInputElement | HTMLTextAreaElement;

/** The values of a field, the first as it was before the user typed, and the one shown. */
interface History {
  readonly values: string[];
  /** The place in `values` of the value the field shows. */
  at: number;
}

/** The history of each field, which goes with the field. */
const histories = new WeakMap<TextField, History>();

/** The field whose value the module is setting itself, whose input event is not typing. */
let restoring: TextField | null = null;

/** Whether `element` is a field the user types text into, whose typing Undo takes back. */
function isTextField(element: EventTarget | null): element is TextField {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && (element.type === "text" || element.type === "search"))
  );
}

/** Before the user changes a field, its value is the first of its history. */
function onBeforeInput(event: Event): void {
  const field = event.target;
  if (!isTextField(field) || field === restoring || histories.has(field)) {
    return;
  }
  histories.set(field, { values: [field.value], at: 0 });
}

/** After the user changed a field, its new value is the last of its history, and nothing is to redo. */
function onInput(event: Event): void {
  const field = event.target;
  if (!isTextField(field) || field === restoring) {
    return;
  }
  const history = histories.get(field);
  if (history === undefined) {
    // A change with no beforeinput, as some text pasted: its value before is lost.
    histories.set(field, { values: [field.value], at: 0 });
    return;
  }
  history.values.splice(history.at + 1, Infinity, field.value);
  history.at = history.values.length - 1;
}

/**
 * Undoes or redoes the typing of `field`, by its own history: its value
 * before or after, with the caret at its end, and an input event, as typing
 * fires, so that what follows the field follows it. With nothing to undo
 * or redo in it, nothing changes.
 */
function editField(field: TextField, action: "undo" | "redo"): void {
  const history = histories.get(field);
  if (history === undefined) {
    return;
  }
  const at = action === "undo" ? history.at - 1 : history.at + 1;
  const value = history.values[at];
  if (value === undefined) {
    return;
  }
  history.at = at;
  restoring = field;
  try {
    // eslint-disable-next-line no-param-reassign -- the field's value is what Undo changes
    field.value = value;
    field.setSelectionRange(value.length, value.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  } finally {
    restoring = null;
  }
}

/**
 * Undoes or redoes the typing in the text field that has the focus, when
 * one has it in a window that has the focus, and says whether one had:
 * Edit > Undo clicked in the menu reaches the window as an action, not as
 * a key. On macOS the app's menu reaches the main window while another is
 * in front, and the field the main window keeps focused behind it is not
 * what the user is undoing.
 */
export function undoOrRedoField(action: "undo" | "redo"): boolean {
  const focused = document.activeElement;
  if (!document.hasFocus() || !isTextField(focused)) {
    return false;
  }
  editField(focused, action);
  return true;
}

/**
 * Keeps the history of every text field of the window, and handles Undo
 * and Redo pressed in one: Cmd-Z and Cmd-Shift-Z on macOS, Ctrl-Z,
 * Ctrl-Shift-Z and on Windows Ctrl-Y elsewhere. The page sees the key before
 * the menu, and takes it from the menu, which would otherwise undo an edit
 * of the table; and while the menu's Undo is greyed out, with nothing to
 * undo in the table, the menu keeps the key from the field, which then
 * undoes nothing. Returns the function that stops it.
 */
export function installFieldUndo(target: Window): () => void {
  const platform = platformOf(target.navigator.userAgent);
  const onKeyDown = (event: KeyboardEvent): void => {
    const action = undoKeyOf(event, platform);
    const field = event.target;
    if (action === null || event.defaultPrevented || !isTextField(field)) {
      return;
    }
    event.preventDefault();
    editField(field, action);
  };
  target.addEventListener("beforeinput", onBeforeInput, true);
  target.addEventListener("input", onInput, true);
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("beforeinput", onBeforeInput, true);
    target.removeEventListener("input", onInput, true);
    target.removeEventListener("keydown", onKeyDown);
  };
}
