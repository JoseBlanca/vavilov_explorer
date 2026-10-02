import { decimalMarksWith, fittedCsvChoices } from "../../state/transfer.ts";
import type { CsvChoices } from "../../state/transfer.ts";
import { createModal } from "../shared/modal.ts";
import { csvDialogView } from "./csvDialog.view.ts";

/** The dialog of a CSV's choices in its element. */
export interface CsvDialog {
  /**
   * Shows the choices, starting from `defaults`, and resolves with those
   * the user exports with, or `null` when they cancel.
   */
  readonly ask: (defaults: CsvChoices) => Promise<CsvChoices | null>;
  /** Cancels a dialog that is open and empties the element. */
  readonly destroy: () => void;
}

/**
 * The dialog of a CSV's choices, in `element`: modal, it takes the focus
 * and gives it back to where it was when it closes. It keeps the choices
 * the user is making, which are the component's own until they export,
 * and moves a decimal comma to the point when the comma is chosen as the
 * separator, the one decimal mark the dialog then offers.
 */
export function createCsvDialog(element: HTMLElement): CsvDialog {
  const modal = createModal<CsvChoices, CsvChoices | null>(
    element,
    "dialog of a CSV's choices",
    ({ content, answer, change }) =>
      csvDialogView({
        choices: content,
        decimalMarks: content === null ? [] : decimalMarksWith(content.separator),
        onChange: (choices) => {
          change(fittedCsvChoices(choices));
        },
        onAnswer: (confirmed) => {
          answer(confirmed ? content : null);
        },
      }),
    null,
  );
  return {
    ask: (defaults) => modal.show(defaults),
    destroy: modal.destroy,
  };
}
