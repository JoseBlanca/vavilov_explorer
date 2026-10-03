import type { Connection } from "../../backend/connection.ts";
import type { ColumnNumbers } from "../../state/columnNumbers.ts";
import { defect } from "../../state/defect.ts";
import type { ColumnId } from "../../state/ids.ts";
import type { Axes } from "../../state/widget.ts";
import type { WindowState } from "../../state/windowState.ts";

/** The columns of a window's axes, as the window's copy of the state has them. */
export interface AxisColumns {
  /** Fetches each column whose revision in the copy is newer than that of the values held. */
  readonly refresh: () => Promise<void>;
  /** The values of the axes, in their order, or `null` while one is not that of the copy. */
  readonly current: () => readonly ColumnNumbers[] | null;
}

/** What the columns of the axes are fetched from: the backend, and the window's copy. */
export interface AxisColumnsSource {
  readonly fetchColumn: Connection["fetchColumn"];
  readonly state: Pick<WindowState, "columnRevision">;
}

/**
 * The values of `axes`, each column fetched once however many axes show it,
 * and again when the copy's revision of it becomes newer than the values
 * held; `onChange` is called when new values arrive. The backend answers at
 * its own revision, which can be ahead of the copy's until the message of
 * the change arrives: those values are kept, and become current with it.
 * A refusal because the column is gone or no longer a number, and an answer
 * for a table replaced since the copy, are not shown: the backend closes the
 * window then.
 */
export function createAxisColumns(
  source: AxisColumnsSource,
  axes: Axes,
  onChange: () => void,
): AxisColumns {
  const held = new Map<ColumnId, ColumnNumbers>();
  const fetching = new Set<ColumnId>();
  const { state } = source;
  const isCurrent = (column: ColumnId): boolean =>
    held.get(column)?.revision === state.columnRevision(column);
  const isBehind = (column: ColumnId): boolean => {
    const wanted = state.columnRevision(column);
    const have = held.get(column)?.revision;
    return wanted !== null && (have === undefined || have < wanted);
  };

  const fetch = async (column: ColumnId): Promise<void> => {
    fetching.add(column);
    try {
      const answer = await source.fetchColumn(column);
      if (!answer.ok) {
        if (answer.error.kind !== "notNumber" && answer.error.kind !== "unknownColumn") {
          throw defect(`column ${String(column)} of a 3D scatter refused as ${answer.error.kind}`);
        }
        return;
      }
      if (answer.value === "stale") {
        return;
      }
      held.set(column, answer.value);
    } finally {
      fetching.delete(column);
    }
    onChange();
    if (isBehind(column)) {
      // The column changed again while it was on its way.
      await fetch(column);
    }
  };

  return {
    refresh: async () => {
      const wanted = [...new Set(axes)].filter(
        (column) => isBehind(column) && !fetching.has(column),
      );
      await Promise.all(wanted.map(fetch));
    },
    current: () => {
      const values = axes.map((column) => (isCurrent(column) ? held.get(column) : undefined));
      return values.every((value) => value !== undefined) ? values : null;
    },
  };
}
