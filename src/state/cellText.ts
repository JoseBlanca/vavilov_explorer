// The text of a cell of the table (docs/design.md, section 2.1): a number in
// the shortest form that gives back the same value, with the decimal mark of
// the user's language and never rounded; a missing value as no text.

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
