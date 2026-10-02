// How the windows write numbers for the user (frontend.md, "Text and
// numbers on screen"): in the user's language, with its decimal mark.

import { defect } from "../../state/defect.ts";

const COUNTS = new Intl.NumberFormat();

/** A count, such as of individuals, with the separators of the user's language. */
export function countText(value: number): string {
  return COUNTS.format(value);
}

/**
 * The decimal mark of the user's language, as `Intl` writes 1.5.
 *
 * @throws A defect when the language writes 1.5 with no decimal mark.
 */
export function decimalMark(): string {
  const mark = new Intl.NumberFormat()
    .formatToParts(1.5)
    .find((part) => part.type === "decimal")?.value;
  if (mark === undefined) {
    throw defect("the language of the window writes 1.5 with no decimal mark");
  }
  return mark;
}
