// A page of rows of the table, as fetch_rows gives it: the names and the
// values of some columns in consecutive rows (docs/core.md, section 5, "A
// page of rows").

import type { ColumnId, LevelCode, Revision, RowIndex } from "./ids.ts";

/** The values of one column in the rows of a page, `null` for a missing value. */
export type PageColumn = {
  /** Its id. */
  readonly id: ColumnId;
  /** The revision at which it last changed, when the page was read. */
  readonly revision: Revision;
} & (
  | { readonly type: "numeric"; readonly values: readonly (number | null)[] }
  | { readonly type: "integer"; readonly values: readonly (bigint | null)[] }
  | { readonly type: "text"; readonly values: readonly (string | null)[] }
  | { readonly type: "boolean"; readonly values: readonly (boolean | null)[] }
  | { readonly type: "categorical"; readonly codes: readonly (LevelCode | null)[] }
);

/** A page of rows. */
export interface RowPage {
  /** The revision of the session when the page was read. */
  readonly revision: Revision;
  /** The revision at which the table it was read from was loaded. */
  readonly loadedAt: Revision;
  /** The first row of the page. */
  readonly first: RowIndex;
  /** The number of rows, which may be 0. */
  readonly count: number;
  /** The name of each row's individual, in order. */
  readonly names: readonly string[];
  /** The columns asked for, in the order asked. */
  readonly columns: readonly PageColumn[];
}
