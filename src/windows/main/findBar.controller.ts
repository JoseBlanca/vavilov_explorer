import { nothing, render } from "lit-html";

import type { Answer, Connection } from "../../backend/connection.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow } from "../../state/description.ts";
import type { Filter } from "../../state/filter.ts";
import {
  NO_DRAFT,
  backendChanged,
  drawnFilter,
  edited,
  sendAnswered,
} from "../../state/findDraft.ts";
import type { FilterOfLoad, FindStep } from "../../state/findDraft.ts";
import { answered } from "../shared/answered.ts";
import { findBarView } from "./findBar.view.ts";

/** The find bar in its element. */
export interface FindBar {
  /** Draws the bar again, when the description of the table has changed. */
  readonly redraw: () => void;
  /** Unsubscribes and empties the element; an answer that comes after draws nothing. */
  readonly destroy: () => void;
}

/** Nothing to draw again for the console's warning of a filter refused: the step below draws. */
const ignore = (): void => undefined;

/**
 * The find bar above the table: it turns what the user types and chooses
 * into the filter of the backend, which holds it and finds the rows
 * (docs/design.md, section 2.1). The whole filter the user asked for is
 * the bar's own until the backend holds it, and at most one filter is on
 * its way to the backend, the newest sent once it is answered
 * (src/state/findDraft.ts); a load drops it, with the text of the field.
 */
export function createFindBar(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  decimalMark: string,
  report: (error: unknown) => void,
): FindBar {
  const { state } = connection;
  let draft = NO_DRAFT;
  let destroyed = false;

  /** The backend's filter in the window's copy, and its load, or `null` with no project. */
  const backend = (): FilterOfLoad | null => {
    const project = state.project();
    if (project.kind === "noProject") {
      return null;
    }
    const filter = state.filter();
    if (filter === null) {
      throw defect(`the table loaded at ${String(project.loadedAt)} with no filter in the copy`);
    }
    return { filter, loadedAt: project.loadedAt };
  };

  const take = (step: FindStep): void => {
    draft = step.draft;
    if (step.send !== null) {
      send(step.send);
    }
  };

  const send = (asked: FilterOfLoad): void => {
    const settle = (outcome: "applied" | "dropped"): void => {
      if (destroyed) {
        return;
      }
      take(sendAnswered(draft, outcome, backend()));
      draw();
    };
    connection
      .setFilter(asked.filter, decimalMark)
      .then(
        (answer: Answer) => {
          answered("filtering the table", ignore)(answer);
          settle(answer.ok && answer.value === "applied" ? "applied" : "dropped");
        },
        (error: unknown) => {
          report(error);
          settle("dropped");
        },
      )
      .catch(report);
  };

  /** The user changed the filter by `filterChange`. */
  const change = (filterChange: Partial<Filter>): void => {
    take(edited(draft, filterChange, backend()));
    draw();
  };

  const draw = (): void => {
    if (destroyed) {
      return;
    }
    const now = description();
    if (now.kind === "none") {
      render(nothing, element);
      return;
    }
    if (now.kind === "behind") {
      // The description of the copy's table is on its way, and draws again.
      return;
    }
    const filter = drawnFilter(draft, backend());
    if (filter === null) {
      throw defect("a find bar drawn for a table with no filter");
    }
    const table = now.description;
    render(
      findBarView({
        text: filter.text,
        columns: [
          { id: table.names.id, name: table.names.header },
          ...table.columns.map((column) => ({ id: column.id, name: column.name })),
        ],
        column: filter.column,
        whole: filter.cell === "whole",
        notMatching: filter.showing === "notMatching",
        onText: (text) => {
          change({ text });
        },
        onColumn: (column) => {
          change({ column });
        },
        onWhole: (whole) => {
          change({ cell: whole ? "whole" : "part" });
        },
        onNotMatching: (notMatching) => {
          change({ showing: notMatching ? "notMatching" : "matching" });
        },
      }),
      element,
    );
  };

  /** The backend's filter, or the table, changed: the pending filter may be dropped. */
  const heard = (): void => {
    draft = backendChanged(draft, backend());
    draw();
  };

  const unsubscribes = [state.subscribe("filter", heard), state.subscribe("table", heard)];
  draw();
  return {
    redraw: draw,
    destroy: () => {
      destroyed = true;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      render(nothing, element);
    },
  };
}
