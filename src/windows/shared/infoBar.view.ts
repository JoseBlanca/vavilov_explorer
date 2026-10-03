import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import type { MessageKind } from "../../state/barMessages.ts";
import { classOf } from "./classOf.ts";
import styles from "./infoBar.module.css";

/** The message the information bar shows, in words. */
export interface InfoBarMessage {
  /** Its kind, which decides its live region and whether it has its ×. */
  readonly kind: MessageKind;
  /** Its kind in words, "Error". */
  readonly kindWords: string;
  /** What happened and how to put it right. */
  readonly text: string;
  /** How many wait behind it, "(2 more)", or empty. */
  readonly waiting: string;
  /** Whether it has its × to dismiss it. */
  readonly dismissable: boolean;
}

/** What the information bar shows. */
export interface InfoBarProps {
  /** The message shown, or `null` for none. */
  readonly message: InfoBarMessage | null;
  /** What the window counts, the rows of the table or the individuals drawn; `null` for none. */
  readonly count: string | null;
  /** The count a screen reader is told, once it stopped changing; empty before. */
  readonly announced: string;
  /** The user dismissed the message shown with ×. */
  readonly onDismiss: () => void;
}

function messageView(message: InfoBarMessage, onDismiss: () => void): TemplateResult {
  return html`<div class=${classOf(styles, message.kind === "error" ? "error" : "message")}>
    <p class=${classOf(styles, "words")}>
      <span class=${classOf(styles, "kind")}>${message.kindWords}:</span>
      ${message.text}
      ${
        message.waiting === ""
          ? nothing
          : html`<span class=${classOf(styles, "waiting")}>${message.waiting}</span>`
      }
    </p>
    ${
      message.dismissable
        ? html`<button
            type="button"
            class=${classOf(styles, "dismiss")}
            aria-label="Dismiss"
            data-dismiss
            @click=${onDismiss}
          >
            ×
          </button>`
        : nothing
    }
  </div>`;
}

/**
 * The information bar at the bottom of a window, the one place for
 * information, warnings and errors about it (docs/design.md, section 2.1):
 * one message at a time, its kind in words, then what the window counts,
 * which is not there with no project open. An error is in a live region that a screen
 * reader reads at once, a warning or an informational message in one that
 * waits for a pause; both are there, empty, while no such message is, so
 * that a reader announces the message put in them. A last live region,
 * hidden from the screen, tells the count once it stops changing, so that
 * it is not read on every key typed in the find bar.
 */
export function infoBarView(props: InfoBarProps): TemplateResult {
  const { message, count } = props;
  const shows = message !== null || count !== null;
  return html`<div class=${classOf(styles, shows ? "bar" : "empty")}>
    <div role="alert">
      ${message?.kind === "error" ? messageView(message, props.onDismiss) : nothing}
    </div>
    <div role="status">
      ${
        message !== null && message.kind !== "error"
          ? messageView(message, props.onDismiss)
          : nothing
      }
    </div>
    ${count === null ? nothing : html`<p class=${classOf(styles, "count")}>${count}</p>`}
    <p class=${classOf(styles, "hidden")} role="status">${props.announced}</p>
  </div>`;
}
