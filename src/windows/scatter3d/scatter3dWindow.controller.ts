import { at } from "../../state/at.ts";
import { defect } from "../../state/defect.ts";
import { createScatter3d } from "../../plots/scatter3d.ts";
import { startPointWindow } from "../shared/pointWindow.controller.ts";
import type { PointPlot } from "../shared/pointView.controller.ts";

/**
 * Starts the window of a 3D scatter in `root`, a point window
 * (pointWindow.controller.ts) of three columns of numbers, named after them,
 * "3D scatter of PC1, PC2 and PC3", whose groups panel has + and − but no
 * Add, Edit or Delete group (docs/design.md, section 2.2).
 */
export async function startScatter3dWindow(root: HTMLElement): Promise<void> {
  await startPointWindow(root, "3D scatter", (spec) => {
    if (spec.kind !== "scatter3d") {
      throw defect(`a 3D scatter's window for a widget of the kind ${spec.kind}`);
    }
    return {
      columns: spec.axes,
      title: (names) => `3D scatter of ${at(names, 0)}, ${at(names, 1)} and ${at(names, 2)}`,
      lacking: "no value on an axis",
      tools: "assigning",
      createPlot: (element, events, tickText): PointPlot => {
        const scatter = createScatter3d(element, events, tickText);
        return {
          update: (data) => {
            const [x, y, z] = data.columns;
            const [xTitle, yTitle, zTitle] = data.titles;
            if (x === undefined || y === undefined || z === undefined) {
              throw defect("a 3D scatter with fewer than three axes");
            }
            if (xTitle === undefined || yTitle === undefined || zTitle === undefined) {
              throw defect("a 3D scatter with fewer than three titles");
            }
            scatter.update({
              values: [x.values, y.values, z.values],
              centres: [x.centre, y.centre, z.centre],
              placed: data.placed,
              name: data.name,
              titles: [xTitle, yTitle, zTitle],
              style: data.style,
              lasso: data.lasso,
            });
          },
          placeOf: scatter.placeOf,
          placeOfDegrees: null,
          focus: scatter.focus,
          destroy: scatter.destroy,
        };
      },
    };
  });
}
