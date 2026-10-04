import { createHistogramTile } from "./histogramTile.controller.ts";
import { startTilesWindow } from "./tilesWindow.controller.ts";

/** Starts the Plots window in `root`, whose tiles are the histograms (docs/design.md, section 2.2). */
export async function startPlotsWindow(root: HTMLElement): Promise<void> {
  await startTilesWindow(root, { title: "Plots", tiles: { histogram: createHistogramTile } });
}
