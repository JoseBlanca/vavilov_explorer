// Undo and Redo of the typing in a text field, by the keyboard and by the
// menu (docs/design.md, sections 2.1 and 10).

import { platformOf, undoKeyOf } from "../../state/undoKeys.ts";

/** Whether `element` is a field the user types text into, whose typing Undo takes back. */
function isTextField(element: EventTarget | null): boolean {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && (element.type === "text" || element.type === "search"))
  );
}

/** Undoes or redoes the typing of the field that has the focus. */
function editField(action: "undo" | "redo"): void {
  // execCommand is the one way to reach a field's own history of typing,
  // which WebKit and Chromium keep, and it fires the field's input event.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- no other API undoes a field's typing
  document.execCommand(action);
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
  const typing = document.hasFocus() && isTextField(document.activeElement);
  if (typing) {
    editField(action);
  }
  return typing;
}

/**
 * Handles Undo and Redo pressed in a text field of the window: Cmd-Z and
 * Cmd-Shift-Z on macOS, Ctrl-Z, Ctrl-Shift-Z and on Windows Ctrl-Y
 * elsewhere. The page sees the key before the menu, and takes it from the
 * menu, which would otherwise undo an edit of the table; and while the
 * menu's Undo is greyed out, with nothing to undo in the table, the menu
 * keeps the key from the field, which then undoes nothing. Returns the
 * function that stops it.
 */
export function installFieldUndo(target: Window): () => void {
  const platform = platformOf(target.navigator.userAgent);
  const onKeyDown = (event: KeyboardEvent): void => {
    const action = undoKeyOf(event, platform);
    if (action === null || event.defaultPrevented || !isTextField(event.target)) {
      return;
    }
    event.preventDefault();
    editField(action);
  };
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("keydown", onKeyDown);
  };
}
