import type { Answer } from "../../backend/connection.ts";
import type { BarMessage } from "../../state/barMessages.ts";
import { defect } from "../../state/defect.ts";
import type { ColumnId } from "../../state/ids.ts";
import { refusalMessage } from "../../state/refusalMessage.ts";
import type { RefusedAction } from "../../state/refusalMessage.ts";

/** How a refusal of an action the user can see refused is told: the action, and the window's bar. */
export interface Telling {
  /** What the user did. */
  readonly action: RefusedAction;
  /** Shows a message in the window's information bar. */
  readonly tell: (message: BarMessage) => void;
  /** The name of a column of the window's copy, or `null` when the copy does not have it. */
  readonly columnName: (column: ColumnId) => string | null;
}

/**
 * What a component does with the answer of a command it sent, `what` in
 * words: when the command was not applied, it draws again, so that a
 * control the user changed, a dropdown that already shows the choice, shows
 * again what the backend holds. A refusal another window can cause is told
 * in the bar, by `telling` (src/state/refusalMessage.ts); any other refusal
 * could come only from a defect of the app, and goes to `report`.
 */
export function answered(
  what: string,
  redraw: () => void,
  report: (error: unknown) => void,
  telling: Telling | null,
): (answer: Answer) => void {
  return (answer) => {
    if (answer.ok && answer.value === "applied") {
      return;
    }
    redraw();
    if (answer.ok) {
      return;
    }
    const message =
      telling === null ? null : refusalMessage(telling.action, answer.error, telling.columnName);
    if (telling === null || message === null) {
      report(defect(`${what} was refused: ${JSON.stringify(answer.error)}`));
      return;
    }
    telling.tell(message);
  };
}
