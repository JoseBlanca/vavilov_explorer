// What is selected in the active classification, as the core's
// SelectedGroups: none, one or several groups, and the unassigned
// individuals or not, kept as a list in the core's order, the groups by
// code and then the unassigned (docs/design.md, section 2.1). Nothing
// selected is every individual.

import type { LevelCode } from "./ids.ts";
import type { Selected } from "./message.ts";

/** What is selected, in the core's order. */
export type SelectedGroups = readonly Selected[];

/** `selected` in the core's order: the groups by code, then the unassigned individuals. */
export function selectionOrdered(selected: SelectedGroups): SelectedGroups {
  return selected.toSorted((first, second) => rank(first) - rank(second));
}

/** The place of a row in the core's order, after every code for the unassigned. */
function rank(selected: Selected): number {
  return selected.kind === "group" ? selected.code : Number.MAX_SAFE_INTEGER;
}

/** The one row selected, what + acts on, or `null` unless exactly one is. */
export function singleOf(selected: SelectedGroups): Selected | null {
  const [first, ...rest] = selected;
  return first !== undefined && rest.length === 0 ? first : null;
}

/**
 * Whether an individual whose code is `code`, as a column's codes hold it,
 * or `null` for an unassigned one, is in what is selected.
 */
export function holdsCode(selected: SelectedGroups, code: number | null): boolean {
  return selected.some((row) => (row.kind === "group" ? row.code === code : code === null));
}

/** The codes of the groups selected, those − takes individuals out of. */
export function removableGroups(selected: SelectedGroups): readonly LevelCode[] {
  return selected.flatMap((row) => (row.kind === "group" ? [row.code] : []));
}

/** Whether `row` is selected. */
export function isRowSelected(selected: SelectedGroups, row: Selected): boolean {
  return selected.some((other) => sameRow(other, row));
}

/** `selected` with `row` added when it was not selected, and taken away when it was. */
export function toggled(selected: SelectedGroups, row: Selected): SelectedGroups {
  return isRowSelected(selected, row)
    ? selected.filter((other) => !sameRow(other, row))
    : selectionOrdered([...selected, row]);
}

/** Whether two selections hold the same rows. */
export function sameSelection(first: SelectedGroups, second: SelectedGroups): boolean {
  return first.length === second.length && first.every((row) => isRowSelected(second, row));
}

/** Whether two rows are the same: one group, or both the unassigned individuals. */
function sameRow(first: Selected, second: Selected): boolean {
  if (first.kind === "unassigned" || second.kind === "unassigned") {
    return first.kind === second.kind;
  }
  return first.code === second.code;
}

/**
 * The rows of `rows`, in their order, from `anchor` to `row` both included,
 * whichever comes first: what a Shift-click selects. With no anchor, or
 * one no longer among the rows, `row` alone.
 */
export function rangeOf(
  rows: readonly Selected[],
  anchor: Selected | null,
  row: Selected,
): SelectedGroups {
  const end = rows.findIndex((other) => sameRow(other, row));
  const start = anchor === null ? -1 : rows.findIndex((other) => sameRow(other, anchor));
  if (end === -1 || start === -1) {
    return [row];
  }
  return selectionOrdered(rows.slice(Math.min(start, end), Math.max(start, end) + 1));
}
