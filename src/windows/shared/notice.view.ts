import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "./classOf.ts";
import styles from "./notice.module.css";

/** What the notice shows, and what dismissing it does. */
export interface NoticeProps {
  /** Its text, or `null` for no notice. */
  readonly text: string | null;
  /** The user dismissed it with ×. */
  readonly onDismiss: () => void;
}

/**
 * A notice across the window, of something the app did that the user
 * should know, which stays until the user dismisses it with ×
 * (docs/design.md, section 2.1). Its live region is there, empty, while
 * there is no notice, so that a screen reader announces the text put in it.
 */
export function noticeView(props: NoticeProps): TemplateResult {
  return html`<div role="status">
    ${
      props.text === null
        ? nothing
        : html`<div class=${classOf(styles, "notice")}>
            <p class=${classOf(styles, "text")}>${props.text}</p>
            <button
              type="button"
              class=${classOf(styles, "dismiss")}
              aria-label="Dismiss"
              @click=${props.onDismiss}
            >
              ×
            </button>
          </div>`
    }
  </div>`;
}
