import { describe, expect, test } from "vitest";

import { pointClickOf } from "./pointClick.ts";

const PLAIN = { metaKey: false, ctrlKey: false };
const CMD = { metaKey: true, ctrlKey: false };
const CTRL = { metaKey: false, ctrlKey: true };

describe("pointClickOf", () => {
  test("on macOS Cmd toggles, and Ctrl, the secondary click, does nothing", () => {
    expect(pointClickOf(PLAIN, "macos")).toBe("select");
    expect(pointClickOf(CMD, "macos")).toBe("toggle");
    expect(pointClickOf(CTRL, "macos")).toBe("none");
  });

  test("on Windows and Linux Ctrl toggles, and the Windows key selects", () => {
    for (const platform of ["windows", "linux"] as const) {
      expect(pointClickOf(PLAIN, platform)).toBe("select");
      expect(pointClickOf(CTRL, platform)).toBe("toggle");
      expect(pointClickOf(CMD, platform)).toBe("select");
    }
  });
});
