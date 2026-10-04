import { describe, expect, test } from "vitest";

import { isWidgetSpec, widgetKindOf } from "./widget.ts";

describe("isWidgetSpec", () => {
  test("a 3D scatter of three columns is one", () => {
    expect(isWidgetSpec({ kind: "scatter3d", axes: [4, 5, 4] })).toBe(true);
  });

  test("a map of a latitude and a longitude, and a map of countries, are ones", () => {
    // The JSON of crates/vavilov-core/src/widgets/tests.rs.
    expect(isWidgetSpec({ kind: "map", latitude: 1, longitude: 4 })).toBe(true);
    expect(isWidgetSpec({ kind: "countryMap", country: 2 })).toBe(true);
    expect(isWidgetSpec({ kind: "map", latitude: 1 })).toBe(false);
    expect(isWidgetSpec({ kind: "countryMap", country: 2, latitude: 1 })).toBe(false);
  });

  test("two axes, a column that is not one, a field more or another kind are not", () => {
    expect(isWidgetSpec({ kind: "scatter3d", axes: [4, 5] })).toBe(false);
    expect(isWidgetSpec({ kind: "scatter3d", axes: [4, 5, -1] })).toBe(false);
    expect(isWidgetSpec({ kind: "scatter3d", axes: [4, 5, 6], title: "x" })).toBe(false);
    expect(isWidgetSpec({ kind: "histogram", axes: [4, 5, 6] })).toBe(false);
  });
});

describe("widgetKindOf", () => {
  test("the label of a 3D scatter's window names its kind", () => {
    expect(widgetKindOf("scatter3d-1")).toBe("scatter3d");
    expect(widgetKindOf("scatter3d-27")).toBe("scatter3d");
  });

  test("the labels of the maps' windows name theirs", () => {
    expect(widgetKindOf("map-2")).toBe("map");
    expect(widgetKindOf("countryMap-3")).toBe("countryMap");
    expect(widgetKindOf("countrymap-3")).toBe(null);
    expect(widgetKindOf("Map-3")).toBe(null);
  });

  test("the main window and a label of no widget have none", () => {
    expect(widgetKindOf("main")).toBe(null);
    expect(widgetKindOf("scatter3d-")).toBe(null);
    expect(widgetKindOf("scatter3d-01")).toBe(null);
    expect(widgetKindOf("xscatter3d-1")).toBe(null);
  });
});
