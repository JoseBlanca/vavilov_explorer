// The values that name things, each a number of its own type, as the
// newtypes of the core (crates/vavilov-core/src/ids.rs). Only the checks
// below make them, so that a row cannot be passed where a column goes.

/** The id of a column, never changed or given again within a table. */
export type ColumnId = number & { readonly __brand: "ColumnId" };
/** A row of the table, from 0, one per individual. */
export type RowIndex = number & { readonly __brand: "RowIndex" };
/** The code of a level of a categorical column; in a classification, a population. */
export type LevelCode = number & { readonly __brand: "LevelCode" };
/** The revision of the session, which only grows. */
export type Revision = number & { readonly __brand: "Revision" };
/** The sequence number of a hover, which takes no revision. */
export type HoverSeq = number & { readonly __brand: "HoverSeq" };
/**
 * The place of a row among the rows the filter shows, from 0, as the
 * table's pages count them; with no filter it equals the row. `Position`
 * of the core.
 */
export type Position = number & { readonly __brand: "Position" };

/** The `u32` that means no column. */
export const NO_COLUMN = 0xffff_ffff;
/** The `u32` that means no row in the hover. */
export const NO_ROW = 0xffff_ffff;
/** The `u16` that means a missing code, or no selected population. */
export const NO_CODE = 0xffff;

function isWhole(value: number, below: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < below;
}

/** Whether `value` can be a column id: a `u32` other than {@link NO_COLUMN}. */
export function isColumnId(value: number): value is ColumnId {
  return isWhole(value, NO_COLUMN);
}

/** Whether `value` can be a row: a `u32` other than {@link NO_ROW}. */
export function isRowIndex(value: number): value is RowIndex {
  return isWhole(value, NO_ROW);
}

/** Whether `value` can be a position among the rows shown: a `u32`. */
export function isPosition(value: number): value is Position {
  return isWhole(value, 2 ** 32);
}

/** Whether `value` can be a level code: a `u16` other than {@link NO_CODE}. */
export function isLevelCode(value: number): value is LevelCode {
  return isWhole(value, NO_CODE);
}

/** Whether `value` can be a revision: a whole number a JavaScript number holds exactly. */
export function isRevision(value: number): value is Revision {
  return Number.isSafeInteger(value) && value >= 0;
}

/** The most rows a table may have, `MAX_ROWS` of the core. */
export const MAX_ROWS = 268_435_456;

/** Whether `value` can be a hover's sequence number, by the bound of a revision. */
export function isHoverSeq(value: number): value is HoverSeq {
  return Number.isSafeInteger(value) && value >= 0;
}
