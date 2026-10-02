// The window a page belongs to, as Tauri names it.

import { getCurrentWindow } from "@tauri-apps/api/window";

/** The label of this page's window: `main`, or a widget's. */
export function currentWindowLabel(): string {
  return getCurrentWindow().label;
}
