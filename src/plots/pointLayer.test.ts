import { describe, expect, test } from "vitest";

import { MARK } from "../state/pointStyle.ts";
import { pointLayer } from "./pointLayer.ts";

describe("the layer a point of a 2D scatter is drawn in", () => {
  test("is the top for the hover, whatever its mark", () => {
    expect(pointLayer(3, 3, MARK.none)).toBe(2);
    expect(pointLayer(3, 3, MARK.lassoAdd)).toBe(2);
  });

  test("is the middle for a point marked, the selected or in a waiting lasso", () => {
    expect(pointLayer(3, null, MARK.marked)).toBe(1);
    expect(pointLayer(3, 4, MARK.lassoRemove)).toBe(1);
  });

  test("is the bottom for the rest", () => {
    expect(pointLayer(3, 4, MARK.none)).toBe(0);
  });
});
