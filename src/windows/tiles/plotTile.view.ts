import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "../shared/classOf.ts";
import styles from "./plotTile.module.css";

/** What a tile shows around its plot. */
export interface PlotTileProps {
  /** The id of its title, unique in the window, which names the tile. */
  readonly titleId: string;
  /** The plot's name, "Histogram of height", or empty before it is known. */
  readonly name: string;
  /** The user pressed the button that closes the tile. */
  readonly onClose: () => void;
  /** Whether the plot has a legend, drawn over its lower left corner, as the map of countries has. */
  readonly legend: boolean;
  /** Why the plot cannot be drawn, shown in its place, or `null` when it can. */
  readonly cannotDraw: string | null;
}

/**
 * A tile of a window of tiles: a title bar with the plot's name and a
 * button that closes the tile, the plot, with its legend over its corner
 * when it has one, or why it cannot be drawn, and under it the line that
 * counts the individuals the plot draws (docs/design.md, section 2.2). The
 * plot, the legend and the count draw into their slots, `data-slot` naming
 * each.
 */
export function plotTileView(props: PlotTileProps): TemplateResult {
  return html`<div class=${classOf(styles, "tile")} aria-labelledby=${props.titleId} role="group">
    <div class=${classOf(styles, "titleBar")}>
      <h2 class=${classOf(styles, "title")} id=${props.titleId}>${props.name}</h2>
      <button
        type="button"
        class=${classOf(styles, "close")}
        aria-label=${`Close ${props.name}`}
        @click=${props.onClose}
      >
        ×
      </button>
    </div>
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
    <div data-slot="count"></div>
  </div>`;
}
