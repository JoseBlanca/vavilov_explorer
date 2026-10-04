import { nothing, render } from "lit-html";

import { at } from "../../state/at.ts";
import { defect } from "../../state/defect.ts";
import { copyName } from "../../state/tileCopy.ts";
import type { Widget } from "../../state/widget.ts";
import { createScatter2d } from "../../plots/scatter2d.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { createPointView, titlesOf } from "../shared/pointView.controller.ts";
import type { PointPlot, PointViewKind } from "../shared/pointView.controller.ts";
import { slot } from "../shared/slot.ts";
import { plotTileView } from "./plotTile.view.ts";
import type { PlotTile, TileContext } from "./tile.ts";

/**
 * Draws the 2D scatter of `widget` in its tile `element`, of the Plots
 * window, the copy `copy` of its plot there: the title bar with its name,
 * "2D scatter of PC1 and PC2", and the button that asks `onClose` to close
 * it; the point view of its two columns (pointView.controller.ts), drawn in
 * SVG, whose lasso is armed by + or − pressed in any window and stays in
 * the tile; and under it the count of the individuals it draws
 * (docs/design.md, section 2.2).
 */
export function createScatter2dTile(
  element: HTMLElement,
  widget: Widget,
  copy: number,
  context: TileContext,
  onClose: () => void,
): PlotTile {
  const { id, spec } = widget;
  if (spec.kind !== "scatter2d") {
    throw defect(`a 2D scatter's tile for a widget of the kind ${spec.kind}`);
  }
  const kind: PointViewKind = {
    columns: spec.axes,
    title: (names) => copyName(`2D scatter of ${at(names, 0)} and ${at(names, 1)}`, copy),
    lacking: "no value on an axis",
    tools: "assigning",
    createPlot: (plotElement, events, tickText): PointPlot => {
      const scatter = createScatter2d(plotElement, events, tickText);
      return {
        update: (data) => {
          const [x, y] = data.columns;
          const [xTitle, yTitle] = data.titles;
          if (x === undefined || y === undefined || xTitle === undefined || yTitle === undefined) {
            throw defect("a 2D scatter without its two columns");
          }
          scatter.update({
            x,
            y,
            titles: [xTitle, yTitle],
            placed: data.placed,
            name: data.name,
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
  let name = "";
  const drawTile = (): void => {
    render(
      plotTileView({
        titleId: `tile-${String(id)}`,
        name,
        onClose,
        legend: false,
        cannotDraw: null,
      }),
      element,
    );
  };
  drawTile();
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
