import { nothing, render } from "lit-html";

import { defect } from "../../state/defect.ts";
import type { Question } from "../../state/question.ts";
import { confirmDialogView } from "./confirmDialog.view.ts";

/** The dialog of a question in its element. */
export interface ConfirmDialog {
  /**
   * Asks `question` and resolves with the answer, `true` to go on. A
   * question asked while another is open answers the first with `false`.
   */
  readonly ask: (question: Question) => Promise<boolean>;
  /** Answers an open question with `false` and empties the element. */
  readonly destroy: () => void;
}

/**
 * The dialog of a question, in `element`: it opens as a modal dialog, which
 * takes the focus, and gives the focus back to where it was when it closes.
 */
export function createConfirmDialog(element: HTMLElement): ConfirmDialog {
  let open: {
    readonly question: Question;
    readonly resolve: (confirmed: boolean) => void;
    readonly focus: Element | null;
  } | null = null;

  const dialog = (): HTMLDialogElement => {
    const found = element.querySelector("dialog");
    if (!(found instanceof HTMLDialogElement)) {
      throw defect("the dialog of a question without its dialog element");
    }
    return found;
  };

  const answer = (confirmed: boolean): void => {
    const answered = open;
    if (answered === null) {
      return;
    }
    open = null;
    draw();
    if (answered.focus instanceof HTMLElement) {
      answered.focus.focus();
    }
    answered.resolve(confirmed);
  };

  const draw = (): void => {
    render(confirmDialogView({ question: open?.question ?? null, onAnswer: answer }), element);
    const shown = dialog();
    if (open !== null && !shown.open) {
      shown.showModal();
    } else if (open === null && shown.open) {
      shown.close();
    }
  };

  draw();
  return {
    ask: (question) => {
      answer(false);
      return new Promise((resolve) => {
        open = { question, resolve, focus: document.activeElement };
        draw();
      });
    },
    destroy: () => {
      answer(false);
      render(nothing, element);
    },
  };
}
