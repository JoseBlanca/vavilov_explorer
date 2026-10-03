import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import type { HoverLabel } from "../../state/hoverLabel.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "./hoverLabel.module.css";

/** What the label of the individual under the pointer shows, and where. */
export interface HoverLabelProps {
  /** The label, or `null` while the pointer is over no individual. */
  readonly label: HoverLabel | null;
  /** Its left edge, in CSS pixels of the window. */
  readonly x: number;
  /** Its top edge, in CSS pixels of the window. */
  readonly y: number;
}

/**
 * The label beside the pointer: the individual's ID, then a line for each
 * value, the column's name and the value. It is text for the eye; a screen
 * reader is not told it, since it follows the pointer.
 */
export function hoverLabelView(props: HoverLabelProps): TemplateResult {
  const { label } = props;
  if (label === null) {
    return html``;
  }
  return html`<div
    class=${classOf(styles, "label")}
    aria-hidden="true"
    style=${`transform: translate(${String(props.x)}px, ${String(props.y)}px)`}
  >
    <p class=${classOf(styles, "title")}>${label.title}</p>
    ${
      label.lines.length === 0
        ? nothing
        : html`<dl class=${classOf(styles, "lines")}>
            ${label.lines.map(
              (line) =>
                html`<dt class=${classOf(styles, "name")}>${line.name}</dt>
                  <dd class=${classOf(styles, "value")}>${line.value}</dd>`,
            )}
          </dl>`
    }
  </div>`;
}
