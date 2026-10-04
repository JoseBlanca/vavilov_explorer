import { describe, expect, test } from "vitest";

import { isColumnId, isWidgetId } from "./ids.ts";
import type { ColumnId, WidgetId } from "./ids.ts";
import type { Widget } from "./widget.ts";
import { isWidgetSpec, onlyWidget, windowKindOf } from "./widget.ts";

describe("isWidgetSpec", () => {
  test("a 3D scatter of three columns is one", () => {
    expect(isWidgetSpec({ kind: "scatter3d", axes: [4, 5, 4] })).toBe(true);
  });

  test("a map of a latitude and a longitude, and a map of countries, are ones", () => {
    // The JSON of src-tauri/src/widgets/tests.rs.
    expect(isWidgetSpec({ kind: "map", latitude: 1, longitude: 4 })).toBe(true);
    expect(isWidgetSpec({ kind: "countryMap", country: 2 })).toBe(true);
    expect(isWidgetSpec({ kind: "histogram", column: 1 })).toBe(true);
    expect(isWidgetSpec({ kind: "histogram", country: 1 })).toBe(false);
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

describe("windowKindOf", () => {
  test("the label of a 3D scatter's window names its kind", () => {
    expect(windowKindOf("scatter3d-1")).toBe("scatter3d");
    expect(windowKindOf("scatter3d-27")).toBe("scatter3d");
  });

  test("the labels of the Plots and the Maps windows name theirs", () => {
    expect(windowKindOf("plots-4")).toBe("plots");
    expect(windowKindOf("maps-2")).toBe("maps");
    expect(windowKindOf("Maps-3")).toBe(null);
  });

  test("a histogram and a map have no window of their own", () => {
    expect(windowKindOf("histogram-4")).toBe(null);
    expect(windowKindOf("map-2")).toBe(null);
    expect(windowKindOf("countryMap-3")).toBe(null);
  });

  test("the main window and a label of no widget have none", () => {
    expect(windowKindOf("main")).toBe(null);
    expect(windowKindOf("scatter3d-")).toBe(null);
    expect(windowKindOf("scatter3d-01")).toBe(null);
    expect(windowKindOf("xscatter3d-1")).toBe(null);
  });
});

describe("onlyWidget", () => {
  const id = (value: number): WidgetId => {
    if (!isWidgetId(value)) throw new Error(`not a widget: ${String(value)}`);
    return value;
  };
  const column = (value: number): ColumnId => {
    if (!isColumnId(value)) throw new Error(`not a column: ${String(value)}`);
    return value;
  };
  const histogram: Widget = { id: id(3), spec: { kind: "histogram", column: column(1) } };

  test("gives the window's one widget", () => {
    expect(onlyWidget([histogram])).toEqual(histogram);
  });

  test("none, or two, is a defect", () => {
    expect(() => onlyWidget([])).toThrow(/holds 0/);
    expect(() => onlyWidget([histogram, { ...histogram, id: id(4) }])).toThrow(/holds 2/);
  });
});
