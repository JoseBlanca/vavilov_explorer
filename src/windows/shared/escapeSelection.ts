// Escape clears the selection, in every window, when nothing before it took
// the key (docs/design.md, section 2.1).

import type { Connection } from "../../backend/connection.ts";
import { countRows } from "../../state/rowSet.ts";
import { answered } from "./answered.ts";
import { takesEscape } from "./takesEscape.ts";

/**
 * Clears the selection when Escape is pressed in `target`, a window,
 * unless something before it took the key, a lasso dropped or + or −
 * released, which mark it taken, or a field typed in or a dialog open,
 * which keep it; registered after those, so that one press does one thing.
 * Returns the function that stops it.
 */
export function installEscapeClearsSelection(
  target: Window,
  connection: Connection,
  report: (error: unknown) => void,
): () => void {
  const { state } = connection;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented || takesEscape(event.target)) {
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
      answered("clearing the selection", () => undefined),
      report,
    );
  };
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("keydown", onKeyDown);
  };
}
