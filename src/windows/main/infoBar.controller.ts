import { nothing, render } from "lit-html";

import type { WindowState } from "../../state/windowState.ts";
import { countRows } from "../../state/rowSet.ts";
import { tableCountText } from "../../state/tableCount.ts";
import { countText } from "../shared/numbers.ts";
import { infoBarView } from "./infoBar.view.ts";

/** The information bar in its element. */
export interface InfoBar {
  /** Unsubscribes and empties the element. */
  readonly destroy: () => void;
}

/**
 * The information bar below the table: the count of the rows the filter
 * shows, of the table and of the selection, drawn again when any of them
 * changes; nothing with no project open.
 */
export function createInfoBar(element: HTMLElement, state: WindowState): InfoBar {
  const draw = (): void => {
    const project = state.project();
    const shown = state.shown();
    if (project.kind !== "open" || shown === null) {
      render(nothing, element);
      return;
    }
    const selection = state.selection();
    render(
      infoBarView({
        count: tableCountText(
          {
            numShown: shown.numShown,
            numRows: project.numRows,
            filtered: shown.filter.text !== "",
            numSelected: selection === null ? 0 : countRows(selection),
          },
          countText,
        ),
      }),
      element,
    );
  };
  const unsubscribes = (["table", "filter", "selection"] as const).map((aspect) =>
    state.subscribe(aspect, draw),
  );
  draw();
  return {
    destroy: () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      render(nothing, element);
    },
  };
}
