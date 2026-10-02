import { describe, expect, test } from "vitest";

import { platformOf, undoKeyOf } from "./undoKeys.ts";
import type { KeyPress } from "./undoKeys.ts";

/** `key` with the modifiers named in `held`. */
function press(key: string, ...held: ("meta" | "ctrl" | "shift" | "alt")[]): KeyPress {
  return {
    key,
    metaKey: held.includes("meta"),
    ctrlKey: held.includes("ctrl"),
    shiftKey: held.includes("shift"),
    altKey: held.includes("alt"),
  };
}

describe("the platform of the web view", () => {
  test("is read from its user agent", () => {
    expect(
      platformOf(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe("macos");
    expect(
      platformOf(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      ),
    ).toBe("windows");
    expect(
      platformOf(
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe("linux");
  });
});

describe("the keys of undo and redo in a field", () => {
  test("on macOS are Cmd-Z and Cmd-Shift-Z", () => {
    expect(undoKeyOf(press("z", "meta"), "macos")).toBe("undo");
    expect(undoKeyOf(press("Z", "meta", "shift"), "macos")).toBe("redo");
    expect(undoKeyOf(press("z", "ctrl"), "macos")).toBeNull();
    expect(undoKeyOf(press("y", "meta"), "macos")).toBeNull();
    expect(undoKeyOf(press("z", "meta", "alt"), "macos")).toBeNull();
    expect(undoKeyOf(press("z"), "macos")).toBeNull();
  });

  test("on Windows are Ctrl-Z, Ctrl-Shift-Z and Ctrl-Y", () => {
    expect(undoKeyOf(press("z", "ctrl"), "windows")).toBe("undo");
    expect(undoKeyOf(press("Z", "ctrl", "shift"), "windows")).toBe("redo");
    expect(undoKeyOf(press("y", "ctrl"), "windows")).toBe("redo");
    expect(undoKeyOf(press("z", "meta"), "windows")).toBeNull();
    expect(undoKeyOf(press("z", "ctrl", "alt"), "windows")).toBeNull();
  });

  test("on Linux are Ctrl-Z and Ctrl-Shift-Z", () => {
    expect(undoKeyOf(press("z", "ctrl"), "linux")).toBe("undo");
    expect(undoKeyOf(press("Z", "ctrl", "shift"), "linux")).toBe("redo");
    expect(undoKeyOf(press("y", "ctrl"), "linux")).toBeNull();
  });
});
