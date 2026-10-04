import { render } from "lit-html";

import { NO_WEBGL_WORDS } from "../../state/widgetMessages.ts";
import { createDefectBar } from "./defectBar.controller.ts";
import type { DefectBar } from "./defectBar.controller.ts";
import { plotWindowView } from "./plotWindow.view.ts";
import { slot } from "./slot.ts";
import { canDrawWebGl } from "./webgl.ts";

/**
 * Draws the frame of a plot's window in `root`, with the plot's legend when
 * `legend`, and the groups panel beside it, which its button hides and
 * shows again, and returns the bar of a defect across its top. On a
 * computer that cannot draw WebGL here, although the main window could, as
 * when the graphics card refuses one more drawing, it says so in the
 * plot's place, titles the window `untitled`, and returns `null`.
 */
export function startPlotFrame(
  root: HTMLElement,
  untitled: string,
  legend: boolean,
): DefectBar | null {
  if (!canDrawWebGl()) {
    document.title = untitled;
    render(plotWindowView({ cannotDraw: NO_WEBGL_WORDS, legend: false, groups: null }), root);
    return null;
  }
  // Whether the groups panel is shown is this window's own, and starts shown.
  let groupsShown = true;
  const drawFrame = (): void => {
    render(
      plotWindowView({
        cannotDraw: null,
        legend,
        groups: {
          shown: groupsShown,
          onToggle: () => {
            groupsShown = !groupsShown;
            drawFrame();
          },
        },
      }),
      root,
    );
  };
  drawFrame();
  return createDefectBar(slot(root, "defect"), window);
}
