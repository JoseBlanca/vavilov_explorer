import { nothing, render } from "lit-html";

import type { Answer, Connection } from "../../backend/connection.ts";
import type { BarMessage } from "../../state/barMessages.ts";
import { levelText } from "../../state/cellText.ts";
import { defect } from "../../state/defect.ts";
import { isCategoricalColumn } from "../../state/description.ts";
import type { DescriptionNow, TableDescription } from "../../state/description.ts";
import { everyShown, sameFilter } from "../../state/filter.ts";
import type { Filter } from "../../state/filter.ts";
import {
  OPERATORS,
  clearedFilterMessage,
  conditionForColumn,
  conditionOf,
  conditionText,
  operatorOf,
  searchedOf,
} from "../../state/findCondition.ts";
import type { ColumnId, Revision } from "../../state/ids.ts";
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
import type { FindValue } from "./findBar.view.ts";

/** The find bar in its element. */
export interface FindBar {
  /** Draws the bar again, when the description of the table has changed. */
  readonly redraw: () => void;
  /** Unsubscribes and empties the element; an answer that comes after draws nothing. */
  readonly destroy: () => void;
}

/**
 * Nothing to draw again for the console's warning of a filter refused, the
 * step below draws, or of a selection refused, which the bar does not show.
 */
const ignore = (): void => undefined;

/**
 * The find bar above the table: it turns what the user types and chooses
 * into the filter of the backend, which holds it and finds the rows
 * (docs/design.md, section 2.1). The whole filter the user asked for is
 * the bar's own until the backend holds it, and at most one filter is on
 * its way to the backend, the newest sent once it is answered
 * (src/state/findDraft.ts); a load drops it, with the text of the field.
 * "Select shown rows" asks the backend to make the rows the table shows,
 * those of the backend's filter in the window's copy, the selection. When
 * the backend clears the filter, a group deleted or its column of another
 * role, `tell` says so in the information bar.
 */
export function createFindBar(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  decimalMark: string,
  tell: (message: BarMessage) => void,
  report: (error: unknown) => void,
): FindBar {
  const { state } = connection;
  let draft = NO_DRAFT;
  let destroyed = false;
  /**
   * The text the field holds, as the user last typed it or the bar last
   * drew it, and the number of the field: a text drawn that is not this one
   * was set from outside, by the backend or a load, and takes a new field.
   */
  let field = { text: "", number: 0 };
  /**
   * The backend's filter as last heard, with the names of its column and of
   * its group then, which the words of a filter it cleared need once the
   * group is gone.
   */
  let lastHeard: {
    readonly filter: Filter;
    readonly loadedAt: Revision;
    readonly names: { readonly column: string; readonly group: string | null };
  } | null = null;

  /** The names of the groups of `column` by their codes, as the table shows them; none for another column. */
  const groupNamesOf = (table: TableDescription, column: ColumnId | null): readonly string[] => {
    const found = table.columns.find((each) => each.id === column);
    return found !== undefined && isCategoricalColumn(found)
      ? found.levels.map((level) => levelText(level.value, found.storage, decimalMark))
      : [];
  };

  /** The name of `column` in `table`, "any column" for none. */
  const columnNameOf = (table: TableDescription, column: ColumnId | null): string => {
    if (column === null) {
      return "any column";
    }
    if (column === table.names.id) {
      return table.names.header;
    }
    const found = table.columns.find((each) => each.id === column);
    if (found === undefined) {
      throw defect(`a filter on column ${String(column)}, not in the table`);
    }
    return found.name;
  };

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
          answered("filtering the table", ignore, report, null)(answer);
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

  const selectShown = (): void => {
    const project = state.project();
    if (project.kind !== "open") {
      return;
    }
    connection
      .setSelection(everyShown(project.numRows, state.shown()))
      .then(answered("selecting the rows shown", ignore, report, null), report);
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
    const heardNow = backend();
    if (lastHeard !== null && heardNow !== null && sameFilter(lastHeard.filter, heardNow.filter)) {
      // The names as the table now has them, which a filter cleared later
      // names.
      lastHeard = { ...lastHeard, names: namesOf(table, lastHeard.filter) };
    }
    const { condition } = filter;
    const searched = searchedOf(table, filter.column);
    const groupNames = groupNamesOf(table, filter.column);
    const operator = operatorOf(condition);
    const text = conditionText(condition, groupNames);
    const fromOutside =
      condition.kind !== "group" && condition.kind !== "missing" && text !== field.text;
    if (fromOutside) {
      field = { text, number: field.number + 1 };
    }
    const document = element.ownerDocument;
    const typing =
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type === "search" &&
      element.contains(document.activeElement);
    const value: FindValue =
      condition.kind === "group"
        ? { kind: "groups", names: groupNames, chosen: condition.code }
        : condition.kind === "missing"
          ? { kind: "none" }
          : { kind: "text", text, field: field.number };
    render(
      findBarView({
        columns: [
          { id: table.names.id, name: table.names.header },
          ...table.columns.map((column) => ({ id: column.id, name: column.name })),
        ],
        column: filter.column,
        operators: OPERATORS[searched],
        operator,
        value,
        notMatching: filter.showing === "notMatching",
        onColumn: (column) => {
          change({
            column,
            condition: conditionForColumn(
              condition,
              groupNames,
              searchedOf(table, column),
              groupNamesOf(table, column),
            ),
          });
        },
        onOperator: (chosen) => {
          change({ condition: conditionOf(chosen, searched, condition, groupNames) });
        },
        onText: (typed) => {
          field = { text: typed, number: field.number };
          change({
            condition: conditionOf(
              operator,
              searched,
              { kind: "contains", text: typed },
              groupNames,
            ),
          });
        },
        onGroup: (code) => {
          change({ condition: { kind: "group", code } });
        },
        onNotMatching: (notMatching) => {
          change({ showing: notMatching ? "notMatching" : "matching" });
        },
        onSelectShown: selectShown,
      }),
      element,
    );
    if (fromOutside && typing) {
      // The new field takes the focus the old one had.
      element.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    }
  };

  /** The names of the column and the group of `filter` in `table`. */
  const namesOf = (
    table: TableDescription,
    filter: Filter,
  ): { readonly column: string; readonly group: string | null } => {
    const group =
      filter.condition.kind === "group"
        ? conditionText(filter.condition, groupNamesOf(table, filter.column))
        : "";
    return { column: columnNameOf(table, filter.column), group: group === "" ? null : group };
  };

  /**
   * The backend's filter, or the table, changed: the pending filter may be
   * dropped, and a filter the backend cleared, with nothing of the bar's
   * own on its way, is told. Whether its column still holds groups comes
   * from the window's copy of the codes, current with the filter, since the
   * description of the table may still be on its way.
   */
  const heard = (): void => {
    const now = backend();
    const quiet = draft.pending === null && draft.sending === null;
    draft = backendChanged(draft, now);
    if (now === null) {
      lastHeard = null;
      draw();
      return;
    }
    const { filter } = now;
    if (quiet && lastHeard !== null) {
      const stillGroups = filter.column !== null && state.codes(filter.column) !== null;
      const message = clearedFilterMessage(lastHeard.filter, filter, lastHeard.names, stillGroups, {
        before: lastHeard.loadedAt,
        after: now.loadedAt,
      });
      if (message !== null) {
        tell(message);
      }
    }
    const described = description();
    lastHeard = {
      filter,
      loadedAt: now.loadedAt,
      names:
        described.kind === "current"
          ? namesOf(described.description, filter)
          : (lastHeard?.names ?? { column: "", group: null }),
    };
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
