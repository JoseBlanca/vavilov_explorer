import { currentWindowLabel } from "../backend/window.ts";
import { defect } from "../state/defect.ts";
import { startMainWindow } from "./main/mainWindow.controller.ts";

/** Starts the window this page belongs to, by its label. */
export async function startWindow(root: HTMLElement): Promise<void> {
  const label = currentWindowLabel();
  if (label !== "main") {
    throw defect(`a window ${label}, of no kind the app has yet`);
  }
  await startMainWindow(root);
}
