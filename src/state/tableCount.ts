// The count of the rows the table shows, as the information bar below it
// writes it (docs/design.md, section 2.1).

/** What the information bar counts. */
export interface TableCount {
  /** The rows the filter shows. */
  readonly numShown: number;
  /** The rows of the table. */
  readonly numRows: number;
  /** Whether the filter has a text, so that it may hide rows. */
  readonly filtered: boolean;
  /** The rows selected, shown or not. */
  readonly numSelected: number;
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
