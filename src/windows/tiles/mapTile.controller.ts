import { at } from "../../state/at.ts";
import { defect } from "../../state/defect.ts";
import { copyName } from "../../state/tileCopy.ts";
import type { Widget } from "../../state/widget.ts";
import { NO_WEBGL_WORDS } from "../../state/widgetMessages.ts";
import { createMap } from "../../plots/map.ts";
import type { PointPlot, PointViewKind } from "../shared/pointView.controller.ts";
import { canDrawWebGl } from "../shared/webgl.ts";
import { createPointViewTile } from "./pointViewTile.controller.ts";
import type { PlotTile, TileContext } from "./tile.ts";

/**
 * Draws the map of the individuals of `widget` in its tile `element`, of the
 * Maps window: the title bar with its name, "Map of lat and lon", and the
 * button that asks `onClose` to close it; the point view of its latitude
 * and longitude (pointView.controller.ts), whose lasso is armed by + or −
 * pressed in any window and stays in the tile; and under it the count of
 * the individuals it draws (docs/design.md, section 2.2). On a computer
 * that cannot draw WebGL here, the tile says so in the plot's place.
 */
export function createMapTile(
  element: HTMLElement,
  widget: Widget,
  copy: number,
  context: TileContext,
  onClose: () => void,
): PlotTile {
  const { id, spec } = widget;
  if (spec.kind !== "map") {
    throw defect(`a map's tile for a widget of the kind ${spec.kind}`);
  }
  const kind: PointViewKind = {
    columns: [spec.latitude, spec.longitude],
    title: (names) => copyName(`Map of ${at(names, 0)} and ${at(names, 1)}`, copy),
    lacking: "no coordinates",
    tools: "assigning",
    createPlot: (plotElement, events): PointPlot => {
      const map = createMap(plotElement, events);
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
        destroy: map.destroy,
      };
    },
  };
  return createPointViewTile(
    element,
    id,
    kind,
    context,
    onClose,
    canDrawWebGl() ? null : NO_WEBGL_WORDS,
  );
}
