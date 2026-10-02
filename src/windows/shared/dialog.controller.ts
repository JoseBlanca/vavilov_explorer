import type { Explanation } from "../../state/fileMessages.ts";
import type { Question } from "../../state/question.ts";
import { dialogView } from "./dialog.view.ts";
import type { DialogContent } from "./dialog.view.ts";
import { createModal } from "./modal.ts";

/** The dialog of the window in its element. */
export interface Dialog {
  /**
   * Asks `question` and resolves with the answer, `true` to go on. What the
   * dialog showed before is answered with `false`, and so is the question
   * when `withdrawn` aborts while it is still asked.
   */
  readonly ask: (question: Question, withdrawn: AbortSignal) => Promise<boolean>;
  /** Shows `explanation` with OK, and resolves when the user closes it. */
  readonly tell: (explanation: Explanation) => Promise<void>;
  /** Answers what it shows with `false` and empties the element. */
  readonly destroy: () => void;
}

/**
 * The dialog of the window, in `element`: it opens as a modal dialog, which
 * takes the focus, and gives the focus back to where it was when it closes.
 */
export function createDialog(element: HTMLElement): Dialog {
  const modal = createModal<NonNullable<DialogContent>, boolean>(
    element,
    "dialog of the window",
    ({ content, answer }) => dialogView({ content, onAnswer: answer }),
    false,
  );
  return {
    ask: (question, withdrawn) => modal.show({ kind: "question", question }, withdrawn),
    tell: async (explanation) => {
      await modal.show({ kind: "explanation", explanation });
    },
    destroy: modal.destroy,
  };
}
