import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import type { Question } from "../../state/question.ts";
import { classOf } from "./classOf.ts";
import styles from "./confirmDialog.module.css";

/** What the dialog of a question shows. */
export interface ConfirmDialogProps {
  /** The question asked, or `null` when none is. */
  readonly question: Question | null;
  /** The user answered: `true` to go on, `false` to keep things as they are. */
  readonly onAnswer: (confirmed: boolean) => void;
}

/**
 * A question before a command whose effect the user may not expect: its
 * heading, what happens, and a button for each answer, the one that keeps
 * things as they are first, so that Enter on the focus it takes keeps them.
 * Escape keeps them too. The controller opens it as a modal dialog.
 */
export function confirmDialogView(props: ConfirmDialogProps): TemplateResult {
  const { question } = props;
  return html`<dialog
    class=${classOf(styles, "dialog")}
    aria-labelledby="confirm-heading"
    aria-describedby="confirm-text"
    @cancel=${(event: Event) => {
      event.preventDefault();
      props.onAnswer(false);
    }}
  >
    ${
      question === null
        ? nothing
        : html`<h2 id="confirm-heading" class=${classOf(styles, "heading")}>${question.heading}</h2>
            <p id="confirm-text" class=${classOf(styles, "text")}>${question.text}</p>
            <div class=${classOf(styles, "answers")}>
              <button
                type="button"
                class=${classOf(styles, "answer")}
                @click=${() => {
                  props.onAnswer(false);
                }}
              >
                ${question.cancel}
              </button>
              <button
                type="button"
                class=${classOf(styles, "answer")}
                @click=${() => {
                  props.onAnswer(true);
                }}
              >
                ${question.confirm}
              </button>
            </div>`
    }
  </dialog>`;
}
