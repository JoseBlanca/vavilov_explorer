// The copies of one plot open as tiles of one window: two histograms of
// the same column, two maps of the same columns. After the first, each is
// named by its number, "Histogram of PC1 (2)", so that the user, and a
// screen reader, can tell them apart; a tile keeps its number while it is
// open (decided by the owner on 4 October 2026).

import type { WidgetSpec } from "./widget.ts";

/** Whether `a` and `b` show the same plot: the same kind and the same columns, in their order. */
export function samePlot(a: WidgetSpec, b: WidgetSpec): boolean {
  switch (a.kind) {
    case "scatter3d":
      return b.kind === "scatter3d" && a.axes.every((axis, index) => axis === b.axes[index]);
    case "map":
      return b.kind === "map" && a.latitude === b.latitude && a.longitude === b.longitude;
    case "countryMap":
      return b.kind === "countryMap" && a.country === b.country;
    case "histogram":
      return b.kind === "histogram" && a.column === b.column;
  }
}

/** A tile open in a window: what it shows, and its number among the copies of its plot. */
export interface OpenCopy {
  /** What it shows. */
  readonly spec: WidgetSpec;
  /** Its number, from 1. */
  readonly copy: number;
}

/** The number of a new tile of `spec`: the smallest, from 1, that no open copy of its plot has. */
export function nextCopy(spec: WidgetSpec, open: readonly OpenCopy[]): number {
  const taken = new Set(open.filter((each) => samePlot(each.spec, spec)).map((each) => each.copy));
  let copy = 1;
  while (taken.has(copy)) {
    copy += 1;
  }
  return copy;
}

/** The name of a tile, `name`, with its number after the first copy: "Histogram of PC1 (2)". */
export function copyName(name: string, copy: number): string {
  return name === "" || copy === 1 ? name : `${name} (${String(copy)})`;
}
