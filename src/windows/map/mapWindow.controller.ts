import { at } from "../../state/at.ts";
import { defect } from "../../state/defect.ts";
import { createMap } from "../../plots/map.ts";
import { startPointWindow } from "../shared/pointWindow.controller.ts";
import type { PointPlot } from "../shared/pointWindow.controller.ts";

/**
 * Starts the window of a map of the individuals in `root`, a point window
 * (pointWindow.controller.ts) of a latitude and a longitude column, named
 * after them, "Map of lat and lon". Its groups panel offers the
 * classification, the groups and + and −, but no Add, Edit or Delete group;
 * its lasso is armed by + or − pressed there or in another window
 * (docs/design.md, section 2.2).
 */
export async function startMapWindow(root: HTMLElement): Promise<void> {
  await startPointWindow(root, "Map", (spec) => {
    if (spec.kind !== "map") {
      throw defect(`a map's window for a widget of the kind ${spec.kind}`);
    }
    return {
      columns: [spec.latitude, spec.longitude],
      title: (names) => `Map of ${at(names, 0)} and ${at(names, 1)}`,
      lacking: "no coordinates",
      tools: "assigning",
      createPlot: (element, events): PointPlot => {
        const map = createMap(element, events);
        return {
          update: (data) => {
            const [latitude, longitude] = data.columns;
            if (latitude === undefined || longitude === undefined) {
              throw defect("a map with no latitude or no longitude");
            }
            map.update({
              latitude,
              longitude,
              placed: data.placed,
              name: data.name,
              style: data.style,
              lasso: data.lasso,
            });
          },
          placeOf: map.placeOf,
          placeOfDegrees: map.placeOfDegrees,
          focus: map.focus,
        };
      },
    };
  });
}
