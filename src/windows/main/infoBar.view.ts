import { html } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "../shared/classOf.ts";
import styles from "./infoBar.module.css";

/** What the information bar shows. */
export interface InfoBarProps {
  /** The count of the rows the table shows, and of those selected. */
  readonly count: string;
  /** The count a screen reader is told, once it stopped changing; empty before. */
  readonly announced: string;
}

/**
 * The information bar below the table, the one place for information,
 * warnings and errors about it (docs/design.md, section 2.1); it shows the
 * count of the rows, and holds, hidden from the screen, the live region
 * that tells a screen reader the count once it stops changing, so that it
 * is not read on every key typed in the find bar.
 */
export function infoBarView(props: InfoBarProps): TemplateResult {
  return html`<div class=${classOf(styles, "bar")}>
    <p class=${classOf(styles, "count")}>${props.count}</p>
    <p class=${classOf(styles, "hidden")} role="status">${props.announced}</p>
  </div>`;
}
