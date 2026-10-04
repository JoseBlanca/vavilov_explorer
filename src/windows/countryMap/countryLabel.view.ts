import { html } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "../shared/classOf.ts";
import styles from "./countryLabel.module.css";

/** What the label of the country under the pointer shows, and where. */
export interface CountryLabelProps {
  /** Its words, or `null` while the pointer is over no country. */
  readonly text: string | null;
  /** Its left edge, in CSS pixels of the window. */
  readonly x: number;
  /** Its top edge, in CSS pixels of the window. */
  readonly y: number;
}

/**
 * The label beside the pointer: the country and how many individuals it
 * holds. It is text for the eye; a screen reader is not told it, since it
 * follows the pointer.
 */
export function countryLabelView(props: CountryLabelProps): TemplateResult {
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
