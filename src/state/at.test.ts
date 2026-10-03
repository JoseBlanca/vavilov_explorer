import { describe, expect, test } from "vitest";

import { at } from "./at.ts";

describe("at", () => {
  test("gives an element that is there, a zero included", () => {
    expect(at(new Float32Array([0, 2.5]), 0)).toBe(0);
    expect(at(["a", "b"], 1)).toBe("b");
  });

  test("an element that is not there is a defect", () => {
    expect(() => at(new Float32Array(2), 2)).toThrow(/no element 2 in an array of 2/);
    expect(() => at([], -1)).toThrow(/no element -1 in an array of 0/);
  });
});
