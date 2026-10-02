import { html } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "../shared/classOf.ts";
import styles from "./mainWindow.module.css";

/** Whether a project is open, which decides what the window shows. */
export interface MainWindowProps {
  /** Whether a project is open. */
  readonly open: boolean;
}

/**
 * The frame of the main window: the bar of a defect across the top, then the
 * populations panel beside the table, or, with no project open, the title in
 * the place of the empty state still to be built, and the dialog of a
 * question, shown over all of it when one is asked. The components draw into
 * the slots, `data-slot` naming each.
 */
export function mainWindowView(props: MainWindowProps): TemplateResult {
  return html`<div class=${classOf(styles, "window")}>
    <div data-slot="defect"></div>
    <div data-slot="dialog"></div>
    <div class=${classOf(styles, props.open ? "body" : "hidden")}>
      <div class=${classOf(styles, "panel")} data-slot="panel"></div>
      <main class=${classOf(styles, "table")} data-slot="table"></main>
    </div>
    ${
      props.open
        ? html``
        : html`<main class=${classOf(styles, "empty")}>
            <h1 class=${classOf(styles, "title")}>Vavilov Explorer</h1>
          </main>`
    }
  </div>`;
}
