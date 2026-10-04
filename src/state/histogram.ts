// What a histogram draws of a numeric column: the bin of each individual,
// the bars stacked by the groups of the active classification, the
// individuals of a segment of a bar, and the words of the segment under the
// pointer (docs/design.md, section 2.2).

import { at } from "./at.ts";
import type { ColumnNumbers } from "./columnNumbers.ts";
import { defect } from "./defect.ts";
import type { GroupRow } from "./groups.ts";
import { NO_CODE } from "./ids.ts";
import type { Selected } from "./message.ts";
import type { Placed } from "./placed.ts";
import { hasRow, rowsWhere, toggledRows } from "./rowSet.ts";
import { holdsCode } from "./selectedGroups.ts";
import type { SelectedGroups } from "./selectedGroups.ts";

/** The number of bins a histogram starts with (decided by the owner on 4 October 2026). */
export const STARTING_BINS = 20;

/** The bins of equal width a column's values are cut into, and the bin of each row. */
export interface Bins {
  /** The left edge of the first bin, the lowest value. */
  readonly lowest: number;
  /** The right edge of the last bin, the highest value. */
  readonly highest: number;
  /** How many bins there are. */
  readonly count: number;
  /** The bin of each row, from 0, or -1 for a row the histogram does not draw. */
  readonly ofRow: Int16Array;
}

/**
 * The bins of `column`, `count` of them, of equal width from its lowest
 * value to its highest, of the rows of `placed`; the highest value is in
 * the last bin. When every value is the same, the bins span one unit
 * around it, and with no row placed they span 0 to 1 and hold none.
 */
export function binsOf(column: ColumnNumbers, placed: Placed, count: number): Bins {
  const { numRows } = placed;
  if (column.values.length !== numRows) {
    throw defect(
      `column ${String(column.column)} of ${String(column.values.length)} rows in a table of ${String(numRows)}`,
    );
  }
  if (!Number.isInteger(count) || count < 1) {
    throw defect(`a histogram of ${String(count)} bins`);
  }
  const ofRow = new Int16Array(numRows).fill(-1);
  // The distances from the centre, as fetched, so that values far from
  // zero and close together keep their differences.
  let least = Infinity;
  let most = -Infinity;
  for (let row = 0; row < numRows; row += 1) {
    if (hasRow(placed.rows, row)) {
      const distance = at(column.values, row);
      least = Math.min(least, distance);
      most = Math.max(most, distance);
    }
  }
  if (least > most) {
    return { lowest: 0, highest: 1, count, ofRow };
  }
  if (least === most) {
    least -= 0.5;
    most += 0.5;
  }
  const width = (most - least) / count;
  for (let row = 0; row < numRows; row += 1) {
    if (hasRow(placed.rows, row)) {
      const bin = Math.floor((at(column.values, row) - least) / width);
      ofRow[row] = Math.min(Math.max(bin, 0), count - 1);
    }
  }
  return { lowest: column.centre + least, highest: column.centre + most, count, ofRow };
}

/** The edges of `bin` of `bins`, the low one included, the high one too in the last bin. */
export function edgesOf(bins: Bins, bin: number): { readonly low: number; readonly high: number } {
  const width = (bins.highest - bins.lowest) / bins.count;
  return {
    low: bins.lowest + bin * width,
    // The last edge is the highest value itself, not a sum that rounding
    // could leave below it.
    high: bin === bins.count - 1 ? bins.highest : bins.lowest + (bin + 1) * width,
  };
}

/**
 * Whose individuals a segment of a bar holds: those of a row of the groups
 * panel, a group or the unassigned individuals; those of every group not
 * selected, the grey segment; or every individual, with no active
 * classification.
 */
export type Part =
  | { readonly kind: "row"; readonly row: Selected }
  | { readonly kind: "others" }
  | { readonly kind: "all" };

/** A segment of a bar: the individuals of one part in one bin. */
export interface Segment {
  /** Its bin, from 0. */
  readonly bin: number;
  /** Whose individuals it holds. */
  readonly part: Part;
  /** The name of its group, `null` for every other part. */
  readonly name: string | null;
  /** Its colour, as CSS writes it. */
  readonly colour: string;
  /** How many individuals the segments below it in its bar hold. */
  readonly bottom: number;
  /** How many individuals it holds, at least one. */
  readonly count: number;
  /** How many of them are selected. */
  readonly selected: number;
}

/** The colours of the parts that are no group, as CSS writes them. */
export interface PartColours {
  /** The unassigned individuals, with no group selected. */
  readonly unassigned: string;
  /** The grey segment of the groups not selected. */
  readonly others: string;
  /** Every individual, with no active classification. */
  readonly unclassified: string;
}

/** What the bars are stacked from. */
export interface StackInput {
  readonly bins: Bins;
  /** The codes of the active classification, `null` with none. */
  readonly codes: Uint16Array | null;
  /** The rows of the groups panel, in its order, the unassigned individuals last. */
  readonly rows: readonly GroupRow[];
  /** The individuals selected, one bit per row, or `null` before the copy has them. */
  readonly selection: Uint8Array | null;
  readonly colours: PartColours;
}

/** The bars, as segments, and the height of the tallest. */
export interface Stack {
  /** The segments, bar by bar from the first bin, and bottom to top in each. */
  readonly segments: readonly Segment[];
  /** The most individuals in one bar, 0 with none. */
  readonly tallest: number;
}

/**
 * The bars of `input`, stacked: with no active classification, one segment
 * a bar; with no group selected, a segment for each row of the panel, in
 * its order; with groups selected, theirs at the bottom, in the panel's
 * order, and one segment of every other individual above them. A segment
 * of no individual is left out.
 *
 * @throws A defect for codes or a selection of another table than the bins'.
 */
export function stackOf(input: StackInput): Stack {
  const { bins, codes, rows, selection, colours } = input;
  const numRows = bins.ofRow.length;
  if (codes !== null && codes.length !== numRows) {
    throw defect(`codes of ${String(codes.length)} rows in a histogram of ${String(numRows)}`);
  }
  if (selection !== null && selection.length !== Math.ceil(numRows / 8)) {
    throw defect(
      `a selection of ${String(selection.length)} bytes in a histogram of ${String(numRows)} rows`,
    );
  }
  const parts = partsOf(codes, rows, colours);
  // The part of each row, by its place in `parts`.
  const partOf = (row: number): number => {
    if (codes === null) {
      return 0;
    }
    const code = at(codes, row);
    return at(parts.slotOfCode, code === NO_CODE ? parts.slotOfCode.length - 1 : code);
  };
  const counts = new Int32Array(bins.count * parts.list.length);
  const selectedCounts = new Int32Array(bins.count * parts.list.length);
  for (let row = 0; row < numRows; row += 1) {
    const bin = at(bins.ofRow, row);
    if (bin < 0) {
      continue;
    }
    const slot = bin * parts.list.length + partOf(row);
    counts[slot] = at(counts, slot) + 1;
    if (selection !== null && hasRow(selection, row)) {
      selectedCounts[slot] = at(selectedCounts, slot) + 1;
    }
  }
  const segments: Segment[] = [];
  let tallest = 0;
  for (let bin = 0; bin < bins.count; bin += 1) {
    let bottom = 0;
    parts.list.forEach((part, index) => {
      const slot = bin * parts.list.length + index;
      const count = at(counts, slot);
      if (count === 0) {
        return;
      }
      segments.push({ bin, ...part, bottom, count, selected: at(selectedCounts, slot) });
      bottom += count;
    });
    tallest = Math.max(tallest, bottom);
  }
  return { segments, tallest };
}

/** A part a bar is stacked from, with its name and colour. */
interface PartDrawn {
  readonly part: Part;
  readonly name: string | null;
  readonly colour: string;
}

/**
 * The parts the bars are stacked from, bottom to top, and the place in
 * that list of each code's individuals, the unassigned ones' last.
 */
function partsOf(
  codes: Uint16Array | null,
  rows: readonly GroupRow[],
  colours: PartColours,
): { readonly list: readonly PartDrawn[]; readonly slotOfCode: readonly number[] } {
  if (codes === null) {
    return {
      list: [{ part: { kind: "all" }, name: null, colour: colours.unclassified }],
      slotOfCode: [],
    };
  }
  const chosen = rows.filter((row) => row.isSelected);
  const shown = chosen.length === 0 ? rows : chosen;
  const list: PartDrawn[] = shown.map((row) => ({
    part: { kind: "row", row: row.selected },
    name: row.name,
    colour: row.colour ?? colours.unassigned,
  }));
  const others = list.length;
  if (chosen.length > 0) {
    list.push({ part: { kind: "others" }, name: null, colour: colours.others });
  }
  // A place for each group of the panel, by its code, and one more for the
  // unassigned individuals; those not shown go to the others'.
  const groups = rows.filter((row) => row.selected.kind === "group").length;
  const slotOfCode = new Array<number>(groups + 1).fill(others);
  shown.forEach((row, index) => {
    const code = row.selected.kind === "group" ? row.selected.code : groups;
    if (code > groups) {
      throw defect(`a group of code ${String(code)} among ${String(groups)} in the panel`);
    }
    slotOfCode[code] = index;
  });
  return { list, slotOfCode };
}

/**
 * The rows of `part` in the bins from `from` to `to`, both included, in
 * either order, one bit per row, with `selected` the groups selected in
 * the active classification whose `codes` are given, `null` with none.
 */
export function rowsOfPart(
  bins: Bins,
  codes: Uint16Array | null,
  selected: SelectedGroups,
  part: Part,
  from: number,
  to: number,
): Uint8Array {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  return rowsWhere(bins.ofRow.length, (row) => {
    const bin = at(bins.ofRow, row);
    if (bin < low || bin > high) {
      return false;
    }
    if (part.kind === "all") {
      return true;
    }
    if (codes === null) {
      throw defect(`the ${part.kind} part of a histogram with no classification`);
    }
    const code = at(codes, row);
    const group = code === NO_CODE ? null : code;
    return part.kind === "others" ? !holdsCode(selected, group) : holdsCode([part.row], group);
  });
}

/**
 * The selection after a click on a segment whose individuals are `rows`,
 * when `now` is selected: with "select", its individuals alone, or none
 * when they were the selection already, as a second click on a group of
 * the panel selects none; with "toggle", the selection with them added, or
 * taken away when all of them were in it.
 */
export function selectionAfterClick(
  now: Uint8Array,
  rows: Uint8Array,
  click: "select" | "toggle",
): Uint8Array {
  if (click === "toggle") {
    return toggledRows(now, rows);
  }
  if (now.length !== rows.length) {
    throw defect(
      `a click on rows of ${String(rows.length)} bytes with a selection of ${String(now.length)}`,
    );
  }
  return now.every((byte, index) => byte === rows[index]) ? new Uint8Array(rows.length) : rows;
}

/** Whether two parts are the same. */
export function samePart(first: Part, second: Part): boolean {
  if (first.kind !== "row" || second.kind !== "row") {
    return first.kind === second.kind;
  }
  if (first.row.kind === "unassigned" || second.row.kind === "unassigned") {
    return first.row.kind === second.row.kind;
  }
  return first.row.code === second.row.code;
}

/**
 * `value`, an edge of bins `width` wide, rounded to two significant digits
 * of the width, so that the label of a bin reads "1.53 to 2.03" and not
 * "1.5333333 to 2.0333333".
 */
export function roundedEdge(value: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(width)) {
    return value;
  }
  const digits = Math.max(0, 1 - Math.floor(Math.log10(width)));
  return Number(value.toFixed(Math.min(digits, 20)));
}

/**
 * The label of `segment`, whose bin spans `low` to `high`, already
 * written: "ESP: 12 individuals, 1.5 to 2", "Unassigned: 1 individual, 1.5
 * to 2", "Other groups: 40 individuals, 1.5 to 2", or with no
 * classification "12 individuals, 1.5 to 2"; `countWords` writes a count in
 * the user's language.
 */
export function segmentText(
  segment: Segment,
  low: string,
  high: string,
  countWords: (value: number) => string,
): string {
  const { part, count } = segment;
  const individuals = `${countWords(count)} ${count === 1 ? "individual" : "individuals"}, ${low} to ${high}`;
  switch (part.kind) {
    case "all":
      return individuals;
    case "others":
      return `Other groups: ${individuals}`;
    case "row":
      return `${part.row.kind === "unassigned" ? "Unassigned" : (segment.name ?? "")}: ${individuals}`;
  }
}
