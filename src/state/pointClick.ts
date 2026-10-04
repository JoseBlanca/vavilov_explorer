// What a click on a point does, by the keys held and the platform
// (docs/design.md, section 2.2).

import type { Platform } from "./undoKeys.ts";

/**
 * How something of a window was clicked: alone, with Cmd or Ctrl to add it
 * or take it away, or with Shift to select a run from the last one
 * clicked; a point, a row of the groups panel, a country or a segment of
 * a histogram.
 */
export type Click = "select" | "toggle" | "range";

/**
 * What a click on a point does: select its individual alone, add it to the
 * selection or take it away, or nothing.
 */
export type PointClick = Exclude<Click, "range"> | "none";

/**
 * What a click on a point does with `keys` held on `platform`: Cmd-click on
 * macOS, Ctrl-click elsewhere, adds the individual or takes it away; on
 * macOS a Ctrl-click is the system's secondary click, and does nothing.
 */
export function pointClickOf(
  keys: { readonly metaKey: boolean; readonly ctrlKey: boolean },
  platform: Platform,
): PointClick {
  if (platform === "macos") {
    if (keys.ctrlKey) {
      return "none";
    }
    return keys.metaKey ? "toggle" : "select";
  }
  return keys.ctrlKey ? "toggle" : "select";
}
