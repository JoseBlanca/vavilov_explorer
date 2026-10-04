import { html } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "./classOf.ts";
import styles from "./textLabel.module.css";

/** What the label beside the pointer shows, and where. */
export interface TextLabelProps {
  /** Its words, or `null` while the pointer is over nothing it names. */
  readonly text: string | null;
  /** Its left edge, in CSS pixels of the window. */
  readonly x: number;
  /** Its top edge, in CSS pixels of the window. */
  readonly y: number;
}

/**
 * The label beside the pointer, such as a country and how many individuals
 * it holds. It is text for the eye; a screen reader is not told it, since
 * it follows the pointer.
 */
export function textLabelView(props: TextLabelProps): TemplateResult {
  if (props.text === null) {
    return html``;
  }
  return html`<p
    class=${classOf(styles, "label")}
    aria-hidden="true"
    style=${`transform: translate(${String(props.x)}px, ${String(props.y)}px)`}
  >
    ${props.text}
  </p>`;
}
