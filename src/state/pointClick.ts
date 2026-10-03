// What a click on a point does, by the keys held and the platform
// (docs/design.md, section 2.2).

import type { Platform } from "./undoKeys.ts";

/**
 * What a click on a point does: select its individual alone, add it to the
 * selection or take it away, or nothing.
 */
export type PointClick = "select" | "toggle" | "none";

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
