import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import type { Question } from "../../state/question.ts";
import { classOf } from "./classOf.ts";
import styles from "./dialog.module.css";

/** What the dialog asks, and what the user's answer does. */
export interface DialogProps {
  /** The question it asks, or `null` while it is closed. */
  readonly question: Question | null;
  /** The user answered: `true` to go on, `false` to keep things as they are. */
  readonly onAnswer: (confirmed: boolean) => void;
}

function answerButton(words: string, onClick: () => void): TemplateResult {
  return html`<button type="button" class=${classOf(styles, "answer")} @click=${onClick}>
    ${words}
  </button>`;
}

/** The heading, the text and the two answers of a question. */
function questionView(question: Question, onAnswer: DialogProps["onAnswer"]): TemplateResult {
  return html`<h2 id="dialog-heading" class=${classOf(styles, "heading")}>${question.heading}</h2>
    <p id="dialog-text" class=${classOf(styles, "text")}>${question.text}</p>
    <div class=${classOf(styles, "answers")}>
      ${answerButton(question.cancel, () => {
        onAnswer(false);
      })}
      ${answerButton(question.confirm, () => {
        onAnswer(true);
      })}
    </div>`;
}

/**
 * A modal dialog of the window, for a question that needs an answer before
 * a command whose effect the user may not expect. It has a button for each
 * answer, the one that keeps things as they are first, so that Enter on the
 * focus it takes keeps them, and Escape keeps them too. What went wrong is
 * told in the information bar, not here (docs/design.md, section 2.1). The
 * controller opens it.
 */
export function dialogView(props: DialogProps): TemplateResult {
  const { question } = props;
  return html`<dialog
    class=${classOf(styles, "dialog")}
    aria-labelledby="dialog-heading"
    aria-describedby="dialog-text"
    @cancel=${(event: Event) => {
      event.preventDefault();
      props.onAnswer(false);
    }}
  >
    ${question === null ? nothing : questionView(question, props.onAnswer)}
  </dialog>`;
}
