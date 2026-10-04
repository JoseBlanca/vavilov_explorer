// The key of Edit > Select None, Shift-Cmd-A on macOS and Shift-Ctrl-A
// elsewhere (docs/design.md, section 2.1), which every window takes itself:
// on Windows and Linux the app's menu is the main window's alone.

import type { KeyPress, Platform } from "./undoKeys.ts";

/** Whether `press` is Select None's key on `platform`. */
export function isSelectNoneKey(press: KeyPress, platform: Platform): boolean {
  const command = platform === "macos" ? press.metaKey : press.ctrlKey;
  const other = platform === "macos" ? press.ctrlKey : press.metaKey;
  return command && !other && press.shiftKey && !press.altKey && press.key.toLowerCase() === "a";
}
