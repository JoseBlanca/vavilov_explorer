import { nothing, render } from "lit-html";

import type { Connection } from "../../backend/connection.ts";
import type { DescriptionNow } from "../../state/description.ts";
import type { Filter } from "../../state/filter.ts";
import { answered } from "../shared/answered.ts";
import { findBarView } from "./findBar.view.ts";

/** The find bar in its element. */
export interface FindBar {
  /** Draws the bar again, when the description of the table has changed. */
  readonly redraw: () => void;
  /** Unsubscribes and empties the element. */
  readonly destroy: () => void;
}

/**
 * The find bar above the table: it turns what the user types and chooses
 * into the filter of the backend, which holds it and finds the rows
 * (docs/design.md, section 2.1). The text being typed is the bar's own
 * until the backend's filter holds it: the bar sends the newest text once
 * the one before is answered, so that typing fast sends no queue of
 * texts, and a filter the backend changed itself, as a load clears it,
 * replaces the text. The column and the checkboxes are drawn from the
 * backend's filter.
 */
export function createFindBar(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  mark: string,
  report: (error: unknown) => void,
): FindBar {
  const { state } = connection;
  /** The text in the field, while it is not yet the backend's. */
  let typed: string | null = null;
  /** Whether a filter is on its way to the backend. */
  let sending = false;
  /** The filter to send once the one on its way is answered. */
  let waiting: Filter | null = null;

  const current = (): Filter | null => state.shown()?.filter ?? null;

  const send = (filter: Filter): void => {
    if (sending) {
      waiting = filter;
      return;
    }
    sending = true;
    connection
      .setFilter(filter, mark)
      .then(answered("filtering the table", draw))
      .then(
        () => {
          sending = false;
          const next = waiting;
          waiting = null;
          if (next !== null) {
            send(next);
          } else if (typed === current()?.text) {
            typed = null;
          }
          draw();
        },
        (error: unknown) => {
          sending = false;
          report(error);
        },
      );
  };

  /** Sends the backend's filter with `change` applied, and the text being typed. */
  const change = (change: Partial<Filter>): void => {
    const filter = current();
    if (filter === null) {
      return;
    }
    send({ ...filter, text: typed ?? filter.text, ...change });
  };

  const draw = (): void => {
    const now = description();
    const filter = current();
    if (now.kind !== "current" || filter === null) {
      if (now.kind === "none") {
        typed = null;
        render(nothing, element);
      }
      return;
    }
    const table = now.description;
    render(
      findBarView({
        text: typed ?? filter.text,
        columns: [
          { id: table.names.id, name: table.names.header },
          ...table.columns.map((column) => ({ id: column.id, name: column.name })),
        ],
        column: filter.column,
        whole: filter.cell === "whole",
        notMatching: filter.shown === "notMatching",
        onText: (text) => {
          typed = text;
          change({ text });
        },
        onColumn: (column) => {
          change({ column });
        },
        onWhole: (whole) => {
          change({ cell: whole ? "whole" : "part" });
        },
        onNotMatching: (notMatching) => {
          change({ shown: notMatching ? "notMatching" : "matching" });
        },
      }),
      element,
    );
  };

  const unsubscribes = [
    state.subscribe("filter", () => {
      // A filter the backend changed while nothing was typed or sent, as a
      // load clears it, is the text of the field.
      if (!sending && waiting === null) {
        typed = null;
      }
      draw();
    }),
    state.subscribe("table", draw),
  ];
  draw();
  return {
    redraw: draw,
    destroy: () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      render(nothing, element);
    },
  };
}
