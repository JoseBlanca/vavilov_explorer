import { currentWindowLabel } from "../backend/window.ts";
import { defect } from "../state/defect.ts";
import { widgetKindOf } from "../state/widget.ts";
import type { WidgetKind } from "../state/widget.ts";
import { startMainWindow } from "./main/mainWindow.controller.ts";

/** Starts the window this page belongs to, by its label. */
export async function startWindow(root: HTMLElement): Promise<void> {
  const label = currentWindowLabel();
  if (label === "main") {
    await startMainWindow(root);
    return;
  }
  const kind = widgetKindOf(label);
  if (kind === null) {
    throw defect(`a window ${label}, of no kind the app has`);
  }
  await WIDGET_STARTS[kind](root);
}

/**
 * The start of each kind of widget's window, one for each kind, each loaded
 * when a window of its kind starts, so that the main window does not load
 * Three.js, two thirds of the windows' code, which it does not draw with.
 */
const WIDGET_STARTS: Readonly<Record<WidgetKind, (root: HTMLElement) => Promise<void>>> = {
  scatter3d: async (root) => {
    const { startScatter3dWindow } = await import("./scatter3d/scatter3dWindow.controller.ts");
    await startScatter3dWindow(root);
  },
  map: async (root) => {
    const { startMapWindow } = await import("./map/mapWindow.controller.ts");
    await startMapWindow(root);
  },
  countryMap: async (root) => {
    const { startCountryMapWindow } = await import("./countryMap/countryMapWindow.controller.ts");
    await startCountryMapWindow(root);
  },
  histogram: async (root) => {
    const { startHistogramWindow } = await import("./histogram/histogramWindow.controller.ts");
    await startHistogramWindow(root);
  },
};
