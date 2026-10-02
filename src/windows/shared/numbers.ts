// How the windows write counts for the user (frontend.md, "Text and
// numbers on screen"), with the separators of the user's language. The
// values of a column take the decimal mark of the system's region, which
// the backend reads (src/state/cellText.ts).

const COUNTS = new Intl.NumberFormat();

/** A count, such as of individuals, with the separators of the user's language. */
export function countText(value: number): string {
  return COUNTS.format(value);
}
