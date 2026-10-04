import { describe, expect, test } from "vitest";

import { besidePointer } from "./besidePointer.ts";

describe("besidePointer", () => {
  const window = { width: 800, height: 600 };

  test("puts the label below the pointer and to its right, 14 pixels off", () => {
    expect(besidePointer({ x: 100, y: 100 }, 200, 50, window)).toEqual({ x: 114, y: 114 });
  });

  test("puts it on the pointer's left near the window's right edge, and above near the bottom", () => {
    expect(besidePointer({ x: 700, y: 590 }, 200, 50, window)).toEqual({ x: 486, y: 550 });
  });

  test("keeps it inside a window too narrow for either side", () => {
    expect(besidePointer({ x: 150, y: 100 }, 200, 50, { width: 300, height: 600 })).toEqual({
      x: 0,
      y: 114,
    });
  });
});
