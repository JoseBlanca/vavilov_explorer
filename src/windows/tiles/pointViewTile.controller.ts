import { nothing, render } from "lit-html";

import { defect } from "../../state/defect.ts";
import type { WidgetId } from "../../state/ids.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { createPointView, titlesOf } from "../shared/pointView.controller.ts";
import type { PointViewKind } from "../shared/pointView.controller.ts";
import { slot } from "../shared/slot.ts";
import { plotTileView } from "./plotTile.view.ts";
import type { PlotTile, TileContext } from "./tile.ts";

/**
 * Draws the point view of the kind `kind` of the widget `id` in its tile
 * `element`, a map of the individuals in the Maps window or a 2D scatter in
 * the Plots window: the title bar with its name and the button that asks
 * `onClose` to close it; the point view (pointView.controller.ts), whose
 * lasso is armed by + or − pressed in any window and stays in the tile; and
 * under it the count of the individuals it draws (docs/design.md, section
 * 2.2). With `cannotDraw`, the words of why the plot cannot be drawn on
 * this computer, the tile shows them in the plot's place.
 */
export function createPointViewTile(
  element: HTMLElement,
  id: WidgetId,
  kind: PointViewKind,
  context: TileContext,
  onClose: () => void,
  cannotDraw: string | null,
): PlotTile {
  let name = "";
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
    tell: context.tell,
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
