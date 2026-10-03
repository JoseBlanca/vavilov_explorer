import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "../shared/classOf.ts";
import styles from "./mainWindow.module.css";

/** Whether a project is open, which decides what the window shows. */
export interface MainWindowProps {
  /** Whether a project is open. */
  readonly open: boolean;
}

/**
 * The frame of the main window: the bar of a defect across the top, then
 * the populations panel beside the table, with the find bar above the
 * table and the information bar below it, or, with no project open, the
 * title in the place of the empty state still to be built, above the
 * information bar, which shows there the messages of an import; and last
 * the slots of the dialogs, which take no space and show over all of it
 * when one is open. The components draw into the slots, `data-slot`
 * naming each.
 */
export function mainWindowView(props: MainWindowProps): TemplateResult {
  return html`<div class=${classOf(styles, "window")}>
    <div data-slot="defect"></div>
    <div class=${classOf(styles, props.open ? "body" : "bodyEmpty")}>
      <div class=${classOf(styles, props.open ? "panel" : "hidden")} data-slot="panel"></div>
      <main class=${classOf(styles, "tableArea")}>
        <div data-slot="find"></div>
        <div class=${classOf(styles, props.open ? "table" : "hidden")} data-slot="table"></div>
        ${
          props.open
            ? nothing
            : html`<div class=${classOf(styles, "empty")}>
                <h1 class=${classOf(styles, "title")}>Vavilov Explorer</h1>
              </div>`
        }
        <div data-slot="info"></div>
      </main>
    </div>
    <div data-slot="dialog"></div>
    <div data-slot="export"></div>
  </div>`;
}
