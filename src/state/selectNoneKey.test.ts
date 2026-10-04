import { describe, expect, test } from "vitest";

import { isSelectNoneKey } from "./selectNoneKey.ts";

const NONE = { key: "A", metaKey: false, ctrlKey: false, shiftKey: true, altKey: false };

describe("Select None's key", () => {
  test("is Shift-Cmd-A on macOS and Shift-Ctrl-A elsewhere", () => {
    expect(isSelectNoneKey({ ...NONE, metaKey: true }, "macos")).toBe(true);
    expect(isSelectNoneKey({ ...NONE, ctrlKey: true }, "windows")).toBe(true);
    expect(isSelectNoneKey({ ...NONE, ctrlKey: true }, "linux")).toBe(true);
    expect(isSelectNoneKey({ ...NONE, ctrlKey: true }, "macos")).toBe(false);
    expect(isSelectNoneKey({ ...NONE, metaKey: true }, "windows")).toBe(false);
  });

  test("is not Select All, nor the key with Alt", () => {
    expect(isSelectNoneKey({ ...NONE, shiftKey: false, key: "a", metaKey: true }, "macos")).toBe(
      false,
    );
    expect(isSelectNoneKey({ ...NONE, metaKey: true, altKey: true }, "macos")).toBe(false);
    expect(isSelectNoneKey({ ...NONE, key: "B", metaKey: true }, "macos")).toBe(false);
  });
});
