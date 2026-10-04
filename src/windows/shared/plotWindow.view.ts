import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "./classOf.ts";
import styles from "./plotWindow.module.css";

/** Whether the groups panel is shown, and the button that shows or hides it. */
export interface PlotGroups {
  /** Whether the panel is shown. */
  readonly shown: boolean;
  /** The user pressed the button that hides or shows it. */
  readonly onToggle: () => void;
}

/** What the window of a plot shows around its components. */
export interface PlotWindowProps {
  /** Why the plot cannot be drawn, shown in its place, or `null` when it can. */
  readonly cannotDraw: string | null;
  /** Whether the plot has a legend, drawn over its corner, as the map of countries has. */
  readonly legend: boolean;
  /** The groups panel beside the plot, or `null` for none, as when it cannot be drawn. */
  readonly groups: PlotGroups | null;
}

function groupsView(groups: PlotGroups): TemplateResult {
  return html`<div class=${classOf(styles, groups.shown ? "side" : "sideHidden")}>
    <button
      type="button"
      class=${classOf(styles, "toggle")}
      aria-expanded=${groups.shown ? "true" : "false"}
      aria-controls="plot-groups"
      @click=${groups.onToggle}
    >
      ${groups.shown ? "Hide groups" : "Show groups"}
    </button>
    <div
      id="plot-groups"
      class=${classOf(styles, groups.shown ? "panel" : "hidden")}
      data-slot="panel"
    ></div>
  </div>`;
}

/**
 * The frame of a plot's window, a 3D scatter or a map: the bar of a defect
 * across the top, then the plot, which fills the window, or why it cannot
 * be drawn, with its legend over its corner when it has one, and the groups
 * panel at its right, which a button hides and shows again; then the
 * information bar at the bottom, with its messages and how many individuals
 * the plot draws (docs/design.md, sections 2.2 and 12); last the slot of the
 * label of what is under the pointer, which takes no space. The components
 * draw into their slots, `data-slot` naming each.
 */
export function plotWindowView(props: PlotWindowProps): TemplateResult {
  return html`<div class=${classOf(styles, "window")}>
    <div data-slot="defect"></div>
    <div class=${classOf(styles, "body")}>
      ${
        props.cannotDraw === null
          ? html`<div class=${classOf(styles, "plotArea")}>
              <div class=${classOf(styles, "plot")} data-slot="plot"></div>
              ${
                props.legend
                  ? html`<div class=${classOf(styles, "legend")} data-slot="legend"></div>`
                  : nothing
              }
            </div>`
          : html`<p class=${classOf(styles, "cannotDraw")} role="alert">${props.cannotDraw}</p>`
      }
      ${props.groups === null ? nothing : groupsView(props.groups)}
    </div>
    <div data-slot="info"></div>
    <div data-slot="label"></div>
  </div>`;
}
