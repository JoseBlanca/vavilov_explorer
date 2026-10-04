import { describe, expect, test } from "vitest";

import { shapePath } from "./pointShapes.ts";

describe("the shape of a point drawn in SVG", () => {
  test("is a circle, a square, a diamond, a cross or an x of the size given", () => {
    expect(shapePath(0, 8)).toBe("M4,0A4,4 0 1 1 -4,0A4,4 0 1 1 4,0Z");
    expect(shapePath(1, 8)).toBe("M-3.5,-3.5H3.5V3.5H-3.5Z");
    expect(shapePath(2, 8)).toBe("M0,-4L4,0L0,4L-4,0Z");
    // A plus whose arms are a third of the size wide.
    expect(shapePath(3, 6)).toBe("M-1,-3H1V-1H3V1H1V3H-1V1H-3V-1H-1Z");
  });

  test("an x is the cross turned by 45 degrees", () => {
    // The corner -1, -3 of the plus turned is (−1 + 3, −1 − 3) / √2.
    expect(shapePath(4, 6)).toBe(
      "M1.41,-2.83L2.83,-1.41L1.41,0L2.83,1.41L1.41,2.83L0,1.41" +
        "L-1.41,2.83L-2.83,1.41L-1.41,0L-2.83,-1.41L-1.41,-2.83L0,-1.41Z",
    );
  });

  test("of a code past the shapes is a defect", () => {
    expect(() => shapePath(5, 8)).toThrow(/defect/);
  });
});
