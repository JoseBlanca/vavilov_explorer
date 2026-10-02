// Which keys undo and redo the typing in a text field on each platform
// (docs/design.md, section 2.1): Cmd-Z and Cmd-Shift-Z on macOS, Ctrl-Z and
// Ctrl-Shift-Z elsewhere, and Ctrl-Y too on Windows.

/** The platform the window runs on, as far as its keys go. */
export type Platform = "macos" | "windows" | "linux";

/** A key pressed, with its modifiers, as a keydown event gives them. */
export interface KeyPress {
  /** The key, `z` or `Z`, as the event's `key`. */
  readonly key: string;
  /** Whether Cmd (on macOS) or the Windows key is down. */
  readonly metaKey: boolean;
  /** Whether Ctrl is down. */
  readonly ctrlKey: boolean;
  /** Whether Shift is down. */
  readonly shiftKey: boolean;
  /** Whether Alt, or Option on macOS, is down. */
  readonly altKey: boolean;
}

/** The platform of a web view whose user agent is `userAgent`. */
export function platformOf(userAgent: string): Platform {
  if (userAgent.includes("Macintosh")) {
    return "macos";
  }
  return userAgent.includes("Windows") ? "windows" : "linux";
}

/** Whether `press` undoes or redoes a field's typing on `platform`, or neither. */
export function undoKeyOf(press: KeyPress, platform: Platform): "undo" | "redo" | null {
  const command = platform === "macos" ? press.metaKey : press.ctrlKey;
  const other = platform === "macos" ? press.ctrlKey : press.metaKey;
  if (!command || other || press.altKey) {
    return null;
  }
  const key = press.key.toLowerCase();
  if (key === "z") {
    return press.shiftKey ? "redo" : "undo";
  }
  return platform === "windows" && key === "y" && !press.shiftKey ? "redo" : null;
}
