import { nothing, render } from "lit-html";

import { at } from "../../state/at.ts";
import { defect } from "../../state/defect.ts";
import type { Widget } from "../../state/widget.ts";
import { NO_WEBGL_WORDS } from "../../state/widgetMessages.ts";
import { createMap } from "../../plots/map.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { createPointView, titlesOf } from "../shared/pointView.controller.ts";
import type { PointPlot, PointViewKind } from "../shared/pointView.controller.ts";
import { slot } from "../shared/slot.ts";
import { canDrawWebGl } from "../shared/webgl.ts";
import { plotTileView } from "./plotTile.view.ts";
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
  context: TileContext,
  onClose: () => void,
): PlotTile {
  const { id, spec } = widget;
  if (spec.kind !== "map") {
    throw defect(`a map's tile for a widget of the kind ${spec.kind}`);
  }
  const kind: PointViewKind = {
    columns: [spec.latitude, spec.longitude],
    title: (names) => `Map of ${at(names, 0)} and ${at(names, 1)}`,
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
  let name = "";
  const cannotDraw = canDrawWebGl() ? null : NO_WEBGL_WORDS;
  const drawTile = (): void => {
    render(
      plotTileView({
        titleId: `tile-${String(id)}`,
        name,
        onClose,
        legend: false,
        cannotDraw,
      }),
      element,
    );
  };
  drawTile();
  if (cannotDraw !== null) {
    return cannotDrawTile(element, (description) => {
      name = kind.title(titlesOf(description, kind.columns));
      drawTile();
    });
  }
  // The view first: the count asks it for its count as soon as it is made,
  // and the view tells the count only once its columns have arrived.
  const view = createPointView(slot(element, "plot"), kind, {
    connection: context.connection,
    table: context.table,
    decimalMark: context.decimalMark,
    hoverLabel: context.hoverLabel,
    hover: context.hover,
    report: context.report,
    tokens: context.tokens,
    onLassoWaiting: () => {
      context.onLassoWaiting(id);
    },
    onDrawn: () => {
      count.recount();
    },
  });
  const count = createInfoBar(
    slot(element, "count"),
    context.connection.state,
    { aspects: [], text: () => view.count() },
    () => {
      view.focus();
    },
  );
  return {
    described: (description) => {
      name = kind.title(titlesOf(description, kind.columns));
      drawTile();
      view.described();
    },
    focus: view.focus,
    // The label of the individual under the pointer is the window's, and
    // Escape leaves it to the point view, which hides it as the pointer
    // leaves the point.
    forgetPointer: () => undefined,
    lassoWaiting: view.lassoWaiting,
    applyLasso: view.applyLasso,
    dropLasso: view.dropLasso,
    plot: view.plot,
    destroy: () => {
      view.destroy();
      count.destroy();
      render(nothing, element);
    },
  };
}

/**
 * A tile whose plot cannot be drawn: it takes the description for its name
 * alone, gives the focus to its button, the one control it has, and has no
 * lasso and no plot.
 */
export function cannotDrawTile(element: HTMLElement, described: PlotTile["described"]): PlotTile {
  return {
    described,
    focus: () => {
      const close = element.querySelector("button");
      if (close === null) {
        throw defect("a tile with no button to close it");
      }
      close.focus();
    },
    forgetPointer: () => undefined,
    lassoWaiting: () => false,
    applyLasso: () => undefined,
    dropLasso: () => undefined,
    plot: undefined,
    destroy: () => {
      render(nothing, element);
    },
  };
}
