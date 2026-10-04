// The count of the rows the table shows, as the information bar below it
// writes it (docs/design.md, section 2.1).

import { defect } from "./defect.ts";
import type { Filter, Shown } from "./filter.ts";
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
  /** The text of the filter's comparison when it is no number, so that it filters nothing; else `null`. */
  readonly unreadable: string | null;
}

/**
 * What the information bar counts, from the window's copy: the project, the
 * rows the filter shows, the selection and the filter; `null` with no
 * project open.
 *
 * @throws A defect when a project is open and the copy has no rows shown or
 * no selection, which the backend sends with every load.
 */
export function tableCountOf(
  project: ProjectState,
  shown: Shown | null,
  selection: Uint8Array | null,
  filter: Filter | null,
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
    unreadable: unreadableOf(shown, filter),
  };
}

/**
 * The text of the filter's comparison when the backend says it is no
 * number, else `null`.
 *
 * @throws A defect when the backend says so of a filter that compares
 * nothing.
 */
function unreadableOf(shown: Shown, filter: Filter | null): string | null {
  if (!shown.unreadableNumber) {
    return null;
  }
  if (filter?.condition.kind !== "compare") {
    throw defect("a number that cannot be read in a filter that compares nothing");
  }
  return filter.condition.text;
}

/**
 * The count the information bar writes, with `count` writing each number
 * in the user's language: "2,000 individuals", or "Showing 312 of 2,000
 * individuals" while a filter filters, then "· “abc” is not a
 * number" when the number of its comparison cannot be read, and "· 45
 * selected" when rows are selected.
 */
export function tableCountText(table: TableCount, count: (value: number) => string): string {
  const individuals = `${count(table.numRows)} ${table.numRows === 1 ? "individual" : "individuals"}`;
  const shown = table.filtered ? `Showing ${count(table.numShown)} of ${individuals}` : individuals;
  const read =
    table.unreadable === null ? shown : `${shown} · “${table.unreadable}” is not a number`;
  return table.numSelected > 0 ? `${read} · ${count(table.numSelected)} selected` : read;
}
