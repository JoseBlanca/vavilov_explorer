import { describe, expect, test } from "vitest";

import { isWidgetSpec, widgetKindOf } from "./widget.ts";

describe("isWidgetSpec", () => {
  test("a 3D scatter of three columns is one", () => {
    expect(isWidgetSpec({ kind: "scatter3d", axes: [4, 5, 4] })).toBe(true);
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

  test("the main window and a label of no widget have none", () => {
    expect(widgetKindOf("main")).toBe(null);
    expect(widgetKindOf("scatter3d-")).toBe(null);
    expect(widgetKindOf("scatter3d-01")).toBe(null);
    expect(widgetKindOf("xscatter3d-1")).toBe(null);
  });
});
