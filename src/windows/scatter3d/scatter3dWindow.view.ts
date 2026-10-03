import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "../shared/classOf.ts";
import styles from "./scatter3dWindow.module.css";

/** Whether the groups panel is shown, and the button that shows or hides it. */
export interface Scatter3dGroups {
  /** Whether the panel is shown. */
  readonly shown: boolean;
  /** The user pressed the button that hides or shows it. */
  readonly onToggle: () => void;
}

/** What the window of a 3D scatter shows around its components. */
export interface Scatter3dWindowProps {
  /** Why the plot cannot be drawn, shown in its place, or `null` when it can. */
  readonly cannotDraw: string | null;
  /** The groups panel beside the plot, or `null` for none, as when it cannot be drawn. */
  readonly groups: Scatter3dGroups | null;
}

function groupsView(groups: Scatter3dGroups): TemplateResult {
  return html`<div class=${classOf(styles, groups.shown ? "side" : "sideHidden")}>
    <button
      type="button"
      class=${classOf(styles, "toggle")}
      aria-expanded=${groups.shown ? "true" : "false"}
      aria-controls="scatter3d-groups"
      @click=${groups.onToggle}
    >
      ${groups.shown ? "Hide groups" : "Show groups"}
    </button>
    <div
      id="scatter3d-groups"
      class=${classOf(styles, groups.shown ? "panel" : "hidden")}
      data-slot="panel"
    ></div>
  </div>`;
}

/**
 * The frame of a 3D scatter's window: the bar of a defect across the top,
 * then the plot, which fills the window, or why it cannot be drawn, with the
 * groups panel at its right, which a button hides and shows again; then the
 * information bar at the bottom, with its messages and how many individuals
 * the plot draws (docs/design.md, sections 2.2 and 12); last the slot of the
 * label of the individual under the pointer, which takes no space. The
 * components draw into their slots, `data-slot` naming each.
 */
export function scatter3dWindowView(props: Scatter3dWindowProps): TemplateResult {
  return html`<div class=${classOf(styles, "window")}>
    <div data-slot="defect"></div>
    <div class=${classOf(styles, "body")}>
      ${
        props.cannotDraw === null
          ? html`<div class=${classOf(styles, "plot")} data-slot="plot"></div>`
          : html`<p class=${classOf(styles, "cannotDraw")} role="alert">${props.cannotDraw}</p>`
      }
      ${props.groups === null ? nothing : groupsView(props.groups)}
    </div>
    <div data-slot="info"></div>
    <div data-slot="label"></div>
  </div>`;
}
