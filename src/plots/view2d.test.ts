import { scaleLinear } from "d3-scale";
import { describe, expect, test } from "vitest";

import {
  MAX_ZOOM,
  MIN_SIDE,
  MIN_ZOOM,
  homeView,
  panView,
  wheelPixels,
  wheelZoom,
  zoomOf,
  zoomView,
} from "./view2d.ts";

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
    // Below 0, the side is a tenth of the value's size, left of right still.
    const below = homeView({ min: -20, max: -20 }, { min: 0, max: 0 });
    expect(below.left).toBeCloseTo(-21);
    expect(below.right).toBeCloseTo(-19);
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

  test("past a limit, as when the framed view changed under it, zooms only the way asked", () => {
    const view = { left: 0, right: 10, bottom: 0, top: 10 };
    // The values grew: the view is 10,000 times nearer than the new frame.
    const wide = { left: 0, right: 100_000, bottom: 0, top: 100_000 };
    expect(zoomView(view, 1.25, 0.5, 0.5, wide)).toEqual(view);
    expect(zoomView(view, 0.8, 0.5, 0.5, wide).right).toBeCloseTo(11.25);
    // The values shrank: the view is 10,000 times further than the new frame.
    const narrow = { left: 0, right: 0.001, bottom: 0, top: 0.001 };
    expect(zoomView(view, 0.8, 0.5, 0.5, narrow)).toEqual(view);
    expect(zoomView(view, 1.25, 0.5, 0.5, narrow).right).toBeCloseTo(9);
  });

  test("framed on one value near the largest number, stays finite", () => {
    const home = homeView({ min: 1e308, max: 1e308 }, { min: 0, max: 1 });
    expect(Number.isFinite(home.left) && Number.isFinite(home.right)).toBe(true);
    expect(home.left / 1e308).toBeCloseTo(0.95);
    expect(home.right / 1e308).toBeCloseTo(1.05);
  });

  test("framed on values closer than the ticks can count, gives them a side that can", () => {
    const home = homeView({ min: 1e-310, max: 1e-310 }, { min: 0, max: 1 });
    expect((home.right - home.left) / MIN_SIDE).toBeCloseTo(1);
    // Zoomed in to the limit, the ticks of d3 can still be counted.
    const near = zoomView(home, MAX_ZOOM, 0.5, 0.5, home);
    expect(scaleLinear().domain([near.left, near.right]).ticks(20).length).toBeGreaterThan(0);
  });

  test("the wheel counts its pixels, lines of 16 and pages of 100, and a pinch ten times", () => {
    // The modes of WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages.
    expect(wheelPixels(100, 0, false)).toBe(100);
    expect(wheelPixels(3, 1, false)).toBe(48);
    expect(wheelPixels(1, 2, false)).toBe(100);
    expect(wheelPixels(-4, 0, true)).toBe(-40);
  });

  test("the wheel zooms as on the maps, 0.95 times for each 100 pixels down", () => {
    expect(wheelZoom(100)).toBeCloseTo(0.95);
    expect(wheelZoom(-200)).toBeCloseTo(1 / 0.9025);
  });
});
