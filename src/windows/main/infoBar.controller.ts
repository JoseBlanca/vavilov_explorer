import { nothing, render } from "lit-html";

import type { WindowState } from "../../state/windowState.ts";
import { tableCountOf, tableCountText } from "../../state/tableCount.ts";
import { countText } from "../shared/numbers.ts";
import { infoBarView } from "./infoBar.view.ts";

/** The information bar in its element. */
export interface InfoBar {
  /** Unsubscribes, stops the count waiting to be announced, and empties the element. */
  readonly destroy: () => void;
}

/**
 * How long the count must stay the same before a screen reader is told it,
 * in milliseconds: a pause in typing, so that the count of each key typed
 * in the find bar is not read out.
 */
const ANNOUNCE_AFTER_MS = 500;

/**
 * The information bar below the table: the count of the rows the filter
 * shows, of the table and of the selection, drawn again when any of them
 * changes, and told to a screen reader once it has not changed for
 * {@link ANNOUNCE_AFTER_MS}; nothing with no project open.
 */
export function createInfoBar(element: HTMLElement, state: WindowState): InfoBar {
  /** The count told to a screen reader. */
  let announced = "";
  /** The count waiting to be told, and its timer. */
  let waiting: { readonly count: string; readonly timer: number } | null = null;

  const stopWaiting = (): void => {
    if (waiting !== null) {
      clearTimeout(waiting.timer);
      waiting = null;
    }
  };

  const draw = (): void => {
    const table = tableCountOf(state.project(), state.shown(), state.selection());
    if (table === null) {
      stopWaiting();
      announced = "";
      render(nothing, element);
      return;
    }
    const count = tableCountText(table, countText);
    if (count === announced) {
      stopWaiting();
    } else if (waiting?.count !== count) {
      stopWaiting();
      waiting = {
        count,
        timer: window.setTimeout(() => {
          waiting = null;
          announced = count;
          draw();
        }, ANNOUNCE_AFTER_MS),
      };
    }
    render(infoBarView({ count, announced }), element);
  };
  const unsubscribes = (["table", "filter", "selection"] as const).map((aspect) =>
    state.subscribe(aspect, draw),
  );
  draw();
  return {
    destroy: () => {
      stopWaiting();
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      render(nothing, element);
    },
  };
}
