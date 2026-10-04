import { describe, expect, test } from "vitest";

import { MAX_ZOOM, MIN_ZOOM, homeView, panView, zoomOf, zoomView } from "./view2d.ts";

describe("the view of a 2D scatter", () => {
  test("framed, puts the points in the middle 90% of each side", () => {
    // x from 0 to 9 fills 9 of 10; y from -2 to 7 the same.
    const home = homeView({ min: 0, max: 9 }, { min: -2, max: 7 });
    expect(home.left).toBeCloseTo(-0.5);
    expect(home.right).toBeCloseTo(9.5);
    expect(home.bottom).toBeCloseTo(-2.5);
    expect(home.top).toBeCloseTo(7.5);
  });

  test("framed on one value, gives it a side of a tenth of the value, or of 1 at 0", () => {
    const home = homeView({ min: 20, max: 20 }, { min: 0, max: 0 });
    expect(home.left).toBeCloseTo(19);
    expect(home.right).toBeCloseTo(21);
    expect(home.bottom).toBeCloseTo(-0.5);
    expect(home.top).toBeCloseTo(0.5);
  });

  test("pans by a share of its width and its height", () => {
    const moved = panView({ left: 0, right: 10, bottom: 0, top: 20 }, 0.1, -0.25);
    expect(moved).toEqual({ left: 1, right: 11, bottom: -5, top: 15 });
  });

  test("zooms about the place under the pointer, which stays where it was", () => {
    const home = { left: 0, right: 10, bottom: 0, top: 10 };
    // Twice as near about x = 2.5 (a quarter from the left), y = 10 (the top).
    const near = zoomView(home, 2, 0.25, 1, home);
    expect(near.left).toBeCloseTo(1.25);
    expect(near.right).toBeCloseTo(6.25);
    expect(near.bottom).toBeCloseTo(5);
    expect(near.top).toBeCloseTo(10);
    expect(zoomOf(near, home)).toBeCloseTo(2);
  });

  test("zooms no further out or in than its limits against the framed view", () => {
    const home = { left: 0, right: 10, bottom: 0, top: 10 };
    expect(zoomOf(zoomView(home, 1e-9, 0.5, 0.5, home), home)).toBeCloseTo(MIN_ZOOM);
    expect(zoomOf(zoomView(home, 1e9, 0.5, 0.5, home), home)).toBeCloseTo(MAX_ZOOM);
  });
});
