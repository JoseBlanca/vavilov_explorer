// The keys that clear the selection in every window (docs/design.md,
// section 2.1): Escape, when nothing before it took the key, and Select
// None's, Shift-Cmd-A, Shift-Ctrl-A elsewhere, which the window takes
// itself since on Windows and Linux the app's menu is the main window's
// alone (section 10).

import type { Connection } from "../../backend/connection.ts";
import { countRows } from "../../state/rowSet.ts";
import { isSelectNoneKey } from "../../state/selectNoneKey.ts";
import { platformOf } from "../../state/undoKeys.ts";
import { answered } from "./answered.ts";
import { takesEscape } from "./takesEscape.ts";

/**
 * Clears the selection, in `target`, a window, on Select None's key, and
 * on Escape unless something before it took the key, a lasso dropped or +
 * or − released, which mark it taken, or a field typed in, which keeps it;
 * registered after those, so that one press does one thing. With a dialog
 * open, neither key clears it. Returns the function that stops it.
 */
export function installSelectionKeys(
  target: Window,
  connection: Connection,
  report: (error: unknown) => void,
): () => void {
  const { state } = connection;
  const platform = platformOf(target.navigator.userAgent);
  const onKeyDown = (event: KeyboardEvent): void => {
    const escape = event.key === "Escape" && !event.defaultPrevented && !takesEscape(event.target);
    if (!escape && !isSelectNoneKey(event, platform)) {
      return;
    }
    if (target.document.querySelector("dialog[open]") !== null) {
      return;
    }
    const selection = state.selection();
    if (selection === null || countRows(selection) === 0) {
      return;
    }
    event.preventDefault();
    connection.setSelection(new Uint8Array(selection.length)).then(
      answered("clearing the selection", () => undefined, report, null),
      report,
    );
  };
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("keydown", onKeyDown);
  };
}
