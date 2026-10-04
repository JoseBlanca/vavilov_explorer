import { createCountryMapTile } from "./countryMapTile.controller.ts";
import { createMapTile } from "./mapTile.controller.ts";
import { startTilesWindow } from "./tilesWindow.controller.ts";

/**
 * Starts the Maps window in `root`, whose tiles are the maps of the
 * individuals and of countries (docs/design.md, section 2.2).
 */
export async function startMapsWindow(root: HTMLElement): Promise<void> {
  await startTilesWindow(root, {
    title: "Maps",
    tiles: { map: createMapTile, countryMap: createCountryMapTile },
  });
}
