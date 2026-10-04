import { createHistogramTile } from "./histogramTile.controller.ts";
import { createScatter2dTile } from "./scatter2dTile.controller.ts";
import { startTilesWindow } from "./tilesWindow.controller.ts";

/** Starts the Plots window in `root`, whose tiles are the histograms and the 2D scatters (docs/design.md, section 2.2). */
export async function startPlotsWindow(root: HTMLElement): Promise<void> {
  await startTilesWindow(root, {
    title: "Plots",
    tiles: { histogram: createHistogramTile, scatter2d: createScatter2dTile },
  });
}
