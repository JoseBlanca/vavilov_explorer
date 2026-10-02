import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import type { Explanation } from "../../state/fileMessages.ts";
import type { Question } from "../../state/question.ts";
import { classOf } from "./classOf.ts";
import styles from "./dialog.module.css";

/** What the dialog shows: a question with two answers, an explanation with OK, or nothing. */
export type DialogContent =
  | { readonly kind: "question"; readonly question: Question }
  | { readonly kind: "explanation"; readonly explanation: Explanation }
  | null;

/** What the dialog shows, and what the user's answer does. */
export interface DialogProps {
  /** What it shows. */
  readonly content: DialogContent;
  /** The user answered: `true` to go on, `false` to keep things as they are, or OK. */
  readonly onAnswer: (confirmed: boolean) => void;
}

function answerButton(words: string, onClick: () => void): TemplateResult {
  return html`<button type="button" class=${classOf(styles, "answer")} @click=${onClick}>
    ${words}
  </button>`;
}

/** The heading, the text and the buttons of what the dialog shows. */
function contentView(
  content: NonNullable<DialogContent>,
  onAnswer: DialogProps["onAnswer"],
): TemplateResult {
  switch (content.kind) {
    case "question":
      return wordsView(
        content.question.heading,
        content.question.text,
        html`${answerButton(content.question.cancel, () => {
          onAnswer(false);
        })}
        ${answerButton(content.question.confirm, () => {
          onAnswer(true);
        })}`,
      );
    case "explanation":
      return wordsView(
        content.explanation.heading,
        content.explanation.text,
        answerButton("OK", () => {
          onAnswer(false);
        }),
      );
  }
}

function wordsView(heading: string, text: string, answers: TemplateResult): TemplateResult {
  return html`<h2 id="dialog-heading" class=${classOf(styles, "heading")}>${heading}</h2>
    <p id="dialog-text" class=${classOf(styles, "text")}>${text}</p>
    <div class=${classOf(styles, "answers")}>${answers}</div>`;
}

/**
 * A modal dialog of the window. A question, before a command whose effect
 * the user may not expect, has a button for each answer, the one that keeps
 * things as they are first, so that Enter on the focus it takes keeps them.
 * An explanation, of what went wrong and how to put it right, has OK.
 * Escape keeps things as they are, or closes the explanation. The
 * controller opens it.
 */
export function dialogView(props: DialogProps): TemplateResult {
  const { content } = props;
  return html`<dialog
    class=${classOf(styles, "dialog")}
    aria-labelledby="dialog-heading"
    aria-describedby="dialog-text"
    @cancel=${(event: Event) => {
      event.preventDefault();
      props.onAnswer(false);
    }}
  >
    ${content === null ? nothing : contentView(content, props.onAnswer)}
  </dialog>`;
}
