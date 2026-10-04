import { describe, expect, test } from "vitest";

import { isColumnId } from "./ids.ts";
import type { ColumnId } from "./ids.ts";
import { copyName, nextCopy, samePlot } from "./tileCopy.ts";
import type { WidgetSpec } from "./widget.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error(`not a column: ${String(value)}`);
  return value;
}

const HEIGHT: WidgetSpec = { kind: "histogram", column: column(3) };
const SEEDS: WidgetSpec = { kind: "histogram", column: column(4) };
const MAP: WidgetSpec = { kind: "map", latitude: column(3), longitude: column(4) };
const TURNED: WidgetSpec = { kind: "map", latitude: column(4), longitude: column(3) };

describe("the copies of one plot in a window", () => {
  test("are the widgets of the same kind and the same columns, in their order", () => {
    expect(samePlot(HEIGHT, { kind: "histogram", column: column(3) })).toBe(true);
    expect(samePlot(HEIGHT, SEEDS)).toBe(false);
    expect(samePlot(MAP, TURNED)).toBe(false);
    expect(samePlot(MAP, { kind: "countryMap", country: column(3) })).toBe(false);
    expect(
      samePlot(
        { kind: "scatter2d", axes: [column(3), column(4)] },
        { kind: "scatter2d", axes: [column(3), column(4)] },
      ),
    ).toBe(true);
    expect(
      samePlot(
        { kind: "scatter2d", axes: [column(3), column(4)] },
        { kind: "scatter2d", axes: [column(4), column(3)] },
      ),
    ).toBe(false);
    expect(
      samePlot(
        { kind: "scatter3d", axes: [column(1), column(2), column(1)] },
        { kind: "scatter3d", axes: [column(1), column(2), column(1)] },
      ),
    ).toBe(true);
  });

  test("take the smallest number no open copy has, from 1", () => {
    expect(nextCopy(HEIGHT, [])).toBe(1);
    expect(nextCopy(HEIGHT, [{ spec: SEEDS, copy: 1 }])).toBe(1);
    expect(
      nextCopy(HEIGHT, [
        { spec: HEIGHT, copy: 1 },
        { spec: SEEDS, copy: 1 },
      ]),
    ).toBe(2);
    // The first closed, its number is free again; the second keeps its own.
    expect(nextCopy(HEIGHT, [{ spec: HEIGHT, copy: 2 }])).toBe(1);
    expect(
      nextCopy(HEIGHT, [
        { spec: HEIGHT, copy: 2 },
        { spec: HEIGHT, copy: 1 },
      ]),
    ).toBe(3);
  });

  test("are named by their number after the first", () => {
    expect(copyName("Histogram of PC1", 1)).toBe("Histogram of PC1");
    expect(copyName("Histogram of PC1", 2)).toBe("Histogram of PC1 (2)");
    // A name not known yet stays empty.
    expect(copyName("", 3)).toBe("");
  });
});
