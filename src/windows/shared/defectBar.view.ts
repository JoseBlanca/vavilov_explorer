import { html } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "./classOf.ts";
import styles from "./defectBar.module.css";

/** What the bar of a defect shows. */
export interface DefectBarProps {
  /** Copies the technical details of the defect for a report. */
  readonly onCopy: () => void;
  /** Whether the details were just copied. */
  readonly copied: boolean;
}

/**
 * The bar shown across the top of a window when the app hits a defect of
 * its own, in the owner's words (docs/design.md, section 12).
 */
export function defectBarView(props: DefectBarProps): TemplateResult {
  return html`<div class=${classOf(styles, "bar")} role="alert">
    <p class=${classOf(styles, "message")}>
      Vavilov Explorer hit an internal error. Your data has not been changed. Please save your work
      and report this.
    </p>
    <button class=${classOf(styles, "copy")} type="button" @click=${props.onCopy}>
      ${props.copied ? "Copied" : "Copy the technical details"}
    </button>
  </div>`;
}
