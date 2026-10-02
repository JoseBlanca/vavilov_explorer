// The text of a cell of the table (docs/design.md, section 2.1): a number in
// the shortest form that gives back the same value, with the decimal mark of
// the user's language and never rounded; a missing value as no text.

import { defect } from "./defect.ts";
import type { LevelValue, StorageType } from "./description.ts";

/** A cell as the table draws it. */
export type Cell =
  | { readonly kind: "missing" }
  | { readonly kind: "value"; readonly text: string; readonly align: "start" | "end" };

/**
 * A number in the shortest form that gives back the same value, as
 * JavaScript writes it, with `decimalMark` in place of the point: 1.5 is
 * "1,5" with a comma. No digit is added or rounded away, and no separator of
 * thousands is added, which the user's file did not have.
 */
export function numberText(value: number, decimalMark: string): string {
  return String(value).replace(".", decimalMark);
}

/** A whole number, every digit of it. */
export function integerText(value: bigint): string {
  return String(value);
}

/** A yes or no, as Excel and R write it in a file. */
export function booleanText(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

/**
 * The text of a level, as the table and the populations panel show it, by
 * the storage type of its column: a whole number is given as text already,
 * every digit of it.
 *
 * @throws A defect for a value of another type than the storage type, which
 * the check of the description makes impossible.
 */
export function levelText(value: LevelValue, storage: StorageType, decimalMark: string): string {
  if (storage === "float" && typeof value === "number") {
    return numberText(value, decimalMark);
  }
  if (storage === "boolean" && typeof value === "boolean") {
    return booleanText(value);
  }
  if ((storage === "integer" || storage === "text") && typeof value === "string") {
    return value;
  }
  throw defect(`a level ${JSON.stringify(value)} of a column of ${storage}`);
}
