import type { AxisColumn } from "../../state/scatterAxes.ts";
import type { Axes } from "../../state/widget.ts";
import { createModal } from "../shared/modal.ts";
import { scatter3dDialogView } from "./scatter3dDialog.view.ts";
import type { Scatter3dChoice } from "./scatter3dDialog.view.ts";

/** The dialog of Plot > 3D scatter… in its element. */
export interface Scatter3dDialog {
  /**
   * Shows `columns` on each axis, starting from `axes`, and resolves with the
   * axes the user opens the 3D scatter with, or `null` when they cancel.
   */
  readonly ask: (columns: readonly AxisColumn[], axes: Axes) => Promise<Axes | null>;
  /** Cancels a dialog that is open and empties the element. */
  readonly destroy: () => void;
}

/**
 * The dialog of Plot > 3D scatter…, in `element`: modal, it takes the focus
 * and gives it back to where it was when it closes. It keeps the axes the
 * user is choosing, which are the component's own until they open the 3D
 * scatter.
 */
export function createScatter3dDialog(element: HTMLElement): Scatter3dDialog {
  const modal = createModal<Scatter3dChoice, Axes | null>(
    element,
    "dialog of a 3D scatter",
    ({ content, answer, change }) =>
      scatter3dDialogView({
        choice: content,
        onChange: (axes) => {
          if (content !== null) {
            change({ ...content, axes });
          }
        },
        onAnswer: (confirmed) => {
          answer(confirmed && content !== null ? content.axes : null);
        },
      }),
    null,
  );
  return {
    ask: (columns, axes) => modal.show({ columns, axes }),
    destroy: modal.destroy,
  };
}
