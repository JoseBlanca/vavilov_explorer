import { currentWindowLabel } from "../backend/window.ts";
import { defect } from "../state/defect.ts";
import { windowKindOf } from "../state/widget.ts";
import type { WindowKind } from "../state/widget.ts";
import { startMainWindow } from "./main/mainWindow.controller.ts";

/** Starts the window this page belongs to, by its label. */
export async function startWindow(root: HTMLElement): Promise<void> {
  const label = currentWindowLabel();
  if (label === "main") {
    await startMainWindow(root);
    return;
  }
  const kind = windowKindOf(label);
  if (kind === null) {
    throw defect(`a window ${label}, of no kind the app has`);
  }
  await WINDOW_STARTS[kind](root);
}

/**
 * The start of each kind of window of the widgets, one for each kind, each
 * loaded when a window of its kind starts, so that the main window does not
 * load Three.js, two thirds of the windows' code, which it does not draw
 * with.
 */
const WINDOW_STARTS: Readonly<Record<WindowKind, (root: HTMLElement) => Promise<void>>> = {
  scatter3d: async (root) => {
    const { startScatter3dWindow } = await import("./scatter3d/scatter3dWindow.controller.ts");
    await startScatter3dWindow(root);
  },
  plots: async (root) => {
    const { startPlotsWindow } = await import("./tiles/plotsWindow.controller.ts");
    await startPlotsWindow(root);
  },
  maps: async (root) => {
    const { startMapsWindow } = await import("./tiles/mapsWindow.controller.ts");
    await startMapsWindow(root);
  },
};
