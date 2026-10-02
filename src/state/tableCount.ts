// The count of the rows the table shows, as the information bar below it
// writes it (docs/design.md, section 2.1).

import { defect } from "./defect.ts";
import type { Shown } from "./filter.ts";
import { countRows } from "./rowSet.ts";
import type { ProjectState } from "./windowState.ts";

/** What the information bar counts. */
export interface TableCount {
  /** The rows the filter shows. */
  readonly numShown: number;
  /** The rows of the table. */
  readonly numRows: number;
  /** Whether a filter is on, so that it may hide rows: the backend then sends the rows shown. */
  readonly filtered: boolean;
  /** The rows selected, shown or not. */
  readonly numSelected: number;
}

/**
 * What the information bar counts, from the window's copy: the project, the
 * rows the filter shows and the selection; `null` with no project open.
 *
 * @throws A defect when a project is open and the copy has no rows shown or
 * no selection, which the backend sends with every load.
 */
export function tableCountOf(
  project: ProjectState,
  shown: Shown | null,
  selection: Uint8Array | null,
): TableCount | null {
  if (project.kind === "noProject") {
    return null;
  }
  const table = `a count of a table of ${String(project.numRows)} rows`;
  if (shown === null) {
    throw defect(`${table} with no rows shown`);
  }
  if (selection === null) {
    throw defect(`${table} with no selection`);
  }
  return {
    numShown: shown.numShown,
    numRows: project.numRows,
    filtered: shown.bits !== null,
    numSelected: countRows(selection),
  };
}

/**
 * The count the information bar writes, with `count` writing each number
 * in the user's language: "2,000 individuals", or "Showing 312 of 2,000
 * individuals" while a filter has a text, then "· 45 selected" when rows
 * are selected.
 */
export function tableCountText(table: TableCount, count: (value: number) => string): string {
  const individuals = `${count(table.numRows)} ${table.numRows === 1 ? "individual" : "individuals"}`;
  const shown = table.filtered ? `Showing ${count(table.numShown)} of ${individuals}` : individuals;
  return table.numSelected > 0 ? `${shown} · ${count(table.numSelected)} selected` : shown;
}
