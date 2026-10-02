import { html } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "../shared/classOf.ts";
import styles from "./infoBar.module.css";

/** What the information bar shows. */
export interface InfoBarProps {
  /** The count of the rows the table shows, and of those selected. */
  readonly count: string;
}

/**
 * The information bar below the table, the one place for information,
 * warnings and errors about it (docs/design.md, section 2.1); it shows the
 * count of the rows, in a live region that announces each change of it to
 * a screen reader.
 */
export function infoBarView(props: InfoBarProps): TemplateResult {
  return html`<div class=${classOf(styles, "bar")}>
    <p class=${classOf(styles, "count")} role="status">${props.count}</p>
  </div>`;
}
