import { html } from "lit-html";
import type { TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { styleMap } from "lit-html/directives/style-map.js";

import type { WidgetId } from "../../state/ids.ts";
import type { TileGrid } from "../../state/tileGrid.ts";
import { classOf } from "../shared/classOf.ts";
import type { PlotGroups } from "../shared/plotWindow.view.ts";
import styles from "./tilesWindow.module.css";

/** What the frame of a window of tiles shows around its components. */
export interface TilesWindowProps {
  /** The widgets, one tile each, in the order they were opened. */
  readonly tiles: readonly WidgetId[];
  /** How the tiles are arranged, and where the groups panel goes. */
  readonly grid: TileGrid;
  /** The groups panel, and the button that hides and shows it. */
  readonly groups: PlotGroups;
}

function groupsView(groups: PlotGroups, inGrid: boolean): TemplateResult {
  const place = inGrid ? "sideInGrid" : "side";
  return html`<div class=${classOf(styles, groups.shown ? place : `${place}Hidden`)}>
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
 * The frame of a window of tiles, the Plots or the Maps window: the bar of a defect
 * across the top; then the tiles, one per widget, each an empty section its
 * component draws into, `data-tile` naming its widget, arranged by
 * `grid`, with the groups panel in a column at their right, or in the empty
 * place at the end of the last row (docs/design.md, section 2.2); then the
 * information bar at the bottom, for the window's messages; last the slots
 * of the labels beside the pointer, of a bar or a country and of an
 * individual, which take no space.
 */
export function tilesWindowView(props: TilesWindowProps): TemplateResult {
  const { grid } = props;
  return html`<div class=${classOf(styles, "window")}>
    <div data-slot="defect"></div>
    <div
      class=${classOf(styles, grid.panelInGrid ? "tilesWithPanel" : "tiles")}
      style=${styleMap({
        "--tile-columns": String(grid.columns),
        "--tile-rows": String(grid.rows),
      })}
    >
      ${repeat(
        props.tiles,
        (id) => id,
        (id) => html`<section class=${classOf(styles, "tile")} data-tile=${String(id)}></section>`,
      )}
      ${groupsView(props.groups, grid.panelInGrid)}
    </div>
    <div data-slot="info"></div>
    <div data-slot="label"></div>
    <div data-slot="hoverLabel"></div>
  </div>`;
}
