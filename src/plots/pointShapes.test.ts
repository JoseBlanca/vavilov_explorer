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
    const x = shapePath(4, 6);
    expect(x.startsWith("M")).toBe(true);
    expect(x.endsWith("Z")).toBe(true);
    const numbers = x.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers.length).toBe(24);
    // Every corner lies within the cross's reach, √(3² + 1²) from the centre.
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      const corner = Math.hypot(numbers[index] ?? 0, numbers[index + 1] ?? 0);
      expect(corner).toBeLessThanOrEqual(Math.hypot(3, 1) + 0.01);
    }
  });

  test("of a code past the shapes is a defect", () => {
    expect(() => shapePath(5, 8)).toThrow(/defect/);
  });
});
