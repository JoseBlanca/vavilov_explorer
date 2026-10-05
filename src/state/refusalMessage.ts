// The words the information bar shows for a command the backend refused
// because another window got ahead of it, in the window where the user
// acted (issue #4, decided by the owner on 5 October 2026). A refusal only
// a defect of the app could cause has no words: it is a defect.

import type { BarMessage } from "./barMessages.ts";
import type { CommandError } from "./commandError.ts";
import type { Role } from "./description.ts";
import type { ColumnId } from "./ids.ts";
import type { EditMode } from "./message.ts";
import { roleWords } from "./widgetMessages.ts";

/** What the user did, whose command the backend refused. */
export type RefusedAction =
  | { readonly kind: "applyLasso" }
  | { readonly kind: "pressButton"; readonly mode: EditMode }
  | { readonly kind: "releaseButton" }
  | { readonly kind: "selectGroups" }
  | { readonly kind: "deleteGroup" }
  | { readonly kind: "chooseClassification"; readonly column: ColumnId }
  | { readonly kind: "setRole"; readonly column: ColumnId; readonly role: Role }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" };

/**
 * The warning for `error`, which refused `action`, with `columnName` the
 * name of a column of the window's copy, or `null` when the copy does not
 * have it; `null` for a refusal only a defect of the app could cause.
 */
export function refusalMessage(
  action: RefusedAction,
  error: CommandError,
  columnName: (column: ColumnId) => string | null,
): BarMessage | null {
  const warning = (text: string): BarMessage => ({ kind: "warning", text });
  const named = (column: ColumnId): string => {
    const name = columnName(column);
    return name === null ? "The column" : `“${name}”`;
  };
  const classificationChanged = error.kind === "notActiveClassification";
  switch (action.kind) {
    case "applyLasso":
      if (error.kind === "noGroupSelected") {
        return warning(
          "The lasso was not applied: no group is selected. Select a group, press + or −, and draw it again.",
        );
      }
      if (error.kind === "notSelected") {
        return warning(
          "The lasso was not applied: the groups selected changed in another window. Draw it again.",
        );
      }
      return classificationChanged
        ? warning(
            "The lasso was not applied: the classification changed in another window. Draw it again.",
          )
        : null;
    case "pressButton":
      if (error.kind === "noGroupSelected") {
        const button = action.mode === "add" ? "+" : "−";
        return warning(`${button} was not pressed: no group is selected. Select a group first.`);
      }
      return error.kind === "notSelected" || classificationChanged ? groupsChanged() : null;
    case "releaseButton":
      return error.kind === "notSelected" || classificationChanged ? groupsChanged() : null;
    case "selectGroups":
      return classificationChanged
        ? warning("The group was not selected: the classification changed in another window.")
        : null;
    case "deleteGroup":
      return classificationChanged
        ? warning("The group was not deleted: the classification changed in another window.")
        : null;
    case "chooseClassification":
      return error.kind === "notCategory"
        ? warning(
            `${named(action.column)} was not made the classification: it is no longer a category.`,
          )
        : null;
    case "setRole":
      return error.kind === "valueNotFor" || error.kind === "roleNotPossible"
        ? warning(
            `${named(action.column)} was not made ${roleWords(action.role)}: one of its values no longer fits.`,
          )
        : null;
    case "undo":
      return error.kind === "nothingToUndo" ? warning("There is nothing to undo.") : null;
    case "redo":
      return error.kind === "nothingToRedo" ? warning("There is nothing to redo.") : null;
  }
}

/** The warning for + or − pressed or released while another window changed the groups selected. */
function groupsChanged(): BarMessage {
  return {
    kind: "warning",
    text: "The groups selected changed in another window. Press + or − again if you still want it.",
  };
}
