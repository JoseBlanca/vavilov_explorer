// What the populations panel shows, derived from the window's copy and the
// description of the table: the classifications to choose from, and the
// rows of the active one, each population with its colour and number of
// individuals, and the unassigned individuals last (docs/design.md,
// section 2.1).

import { defect } from "./defect.ts";
import { levelText } from "./cellText.ts";
import type { TableDescription } from "./description.ts";
import { NO_CODE, isLevelCode } from "./ids.ts";
import type { ColumnId, LevelCode } from "./ids.ts";
import type { Selected } from "./message.ts";
import type { Active } from "./windowState.ts";

/** A classification the user can make the active one. */
export interface Classification {
  /** Its id. */
  readonly column: ColumnId;
  /** Its name, as in the user's file. */
  readonly name: string;
}

/** A row of the panel: a population, or the unassigned individuals. */
export interface PopulationRow {
  /** What selecting the row selects. */
  readonly selected: Selected;
  /** The population's value as text, or `null` for the unassigned individuals. */
  readonly name: string | null;
  /** The population's colour, `#rrggbb`, or `null` for the unassigned. */
  readonly colour: string | null;
  /** How many individuals it holds. */
  readonly count: number;
  /** Whether it is the one selected for editing. */
  readonly isSelected: boolean;
}

/** What the panel shows. */
export interface PopulationsModel {
  /** Every classification, in the order of the table. */
  readonly classifications: readonly Classification[];
  /** The active classification, or `null`. */
  readonly active: ColumnId | null;
  /** Its populations in the order of their codes, then the unassigned; empty with none active. */
  readonly rows: readonly PopulationRow[];
}

/**
 * The panel's model.
 *
 * @throws A defect when the codes of the active classification do not fit
 * its levels or the table, which the backend makes impossible.
 */
export function populationsModel(
  description: TableDescription,
  active: Active | null,
  codesOf: (column: ColumnId) => Uint16Array | null,
  decimalMark: string,
): PopulationsModel {
  const classifications = description.columns.flatMap((column) =>
    column.role === "classification" ? [{ column: column.id, name: column.name }] : [],
  );
  if (active === null) {
    return { classifications, active: null, rows: [] };
  }
  const column = description.columns.find((candidate) => candidate.id === active.column);
  if (column?.role !== "classification") {
    throw defect(
      `the active classification, column ${String(active.column)}, is not a classification`,
    );
  }
  const codes = codesOf(active.column);
  if (codes === null) {
    throw defect(`the active classification, column ${String(active.column)}, has no codes`);
  }
  if (codes.length !== description.numRows) {
    throw defect(
      `${String(codes.length)} codes for the active classification of a table of ${String(description.numRows)} rows`,
    );
  }
  const counts = new Array<number>(column.levels.length).fill(0);
  let unassigned = 0;
  for (const value of codes) {
    if (value === NO_CODE) {
      unassigned += 1;
    } else {
      const count = counts[value];
      if (count === undefined) {
        throw defect(
          `a code ${String(value)} in a classification of ${String(counts.length)} levels`,
        );
      }
      counts[value] = count + 1;
    }
  }
  const rows: PopulationRow[] = column.levels.map((level, index) => {
    const selected: Selected = { kind: "population", code: levelCode(index) };
    const count = counts[index];
    if (count === undefined) {
      throw defect(`no count for level ${String(index)}`);
    }
    return {
      selected,
      name: levelText(level.value, column.storage, decimalMark),
      colour: level.colour,
      count,
      isSelected: sameSelected(active.selected, selected),
    };
  });
  rows.push({
    selected: { kind: "unassigned" },
    name: null,
    colour: null,
    count: unassigned,
    isSelected: active.selected?.kind === "unassigned",
  });
  return { classifications, active: active.column, rows };
}

function levelCode(index: number): LevelCode {
  if (!isLevelCode(index)) {
    throw defect(`a level at ${String(index)}, beyond the codes`);
  }
  return index;
}

/** Whether two selections are the same. */
export function sameSelected(first: Selected | null, second: Selected | null): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  if (first.kind === "unassigned" || second.kind === "unassigned") {
    return first.kind === second.kind;
  }
  return first.code === second.code;
}
