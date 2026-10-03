// The colour, size, shape and mark of every point of a point view, from the
// groups of the active classification, what is selected in it, the
// selection, the hover and the window's waiting lasso (docs/design.md,
// section 3: one function, shared by the point views of every window;
// docs/prototype-lessons.md, "Rendering" and "Interaction").

import { at } from "./at.ts";
import { defect } from "./defect.ts";
import type { RowIndex } from "./ids.ts";
import { NO_CODE } from "./ids.ts";
import { PALETTE } from "./palette.ts";
import type { EditMode } from "./message.ts";
import { hasRow } from "./rowSet.ts";
import { holdsCode } from "./selectedGroups.ts";
import type { SelectedGroups } from "./selectedGroups.ts";

/** A colour as the GPU takes it: red, green and blue from 0 to 1. */
export type Rgb = readonly [number, number, number];

/**
 * The diameter of a point, in CSS pixels, when no group is selected:
 * chosen by the assistant on 3 October 2026, for the owner to judge.
 */
export const POINT_SIZE_PX = 8;
/** The size of the points of the groups selected, against {@link POINT_SIZE_PX}: the prototype's. */
export const SELECTED_GROUP_SCALE = 1.5;
/** The size of the points of the other groups while some are selected: the prototype's. */
export const OTHER_GROUP_SCALE = 0.4;
/**
 * The size of the individual under the pointer, against
 * {@link POINT_SIZE_PX}, so that it stands out from the selection.
 */
export const HOVER_SCALE = 2;

/**
 * The shapes a point can take, in the order of their codes in the shader.
 * A group's shape changes each time the list of colours starts again, so
 * that two groups of one colour still differ (docs/design.md, section 5).
 */
export const SHAPES = ["circle", "square", "diamond", "cross", "x"] as const;

/** How many colours the list of the groups has before it starts again. */
const COLOURS_IN_LIST = PALETTE.length;

/**
 * The mark of a point, as the shader draws it: none; the ring of an
 * individual selected or hovered; the ring of one inside a waiting lasso
 * with + pressed, which it would add; or with − pressed, which it would
 * take out.
 */
export const MARK = { none: 0, marked: 1, lassoAdd: 2, lassoRemove: 3 } as const;

/** What the style of the points is computed from. */
export interface PointStyleInput {
  /** The rows of the table. */
  readonly numRows: number;
  /** The codes of the active classification, or `null` with none. */
  readonly codes: Uint16Array | null;
  /** The colour of each group, by code. */
  readonly groupColours: readonly Rgb[];
  /** The colour of an unassigned individual. */
  readonly unassigned: Rgb;
  /** The colour of every point while there is no active classification. */
  readonly unclassified: Rgb;
  /** What is selected in the active classification; empty for nothing. */
  readonly selected: SelectedGroups;
  /** The selection, one bit per row, or `null` with none. */
  readonly selection: Uint8Array | null;
  /** The individual under the pointer, in any window. */
  readonly hover: RowIndex | null;
  /** The rows inside this window's waiting lasso, and the button it was drawn with. */
  readonly lasso: { readonly rows: Uint8Array; readonly mode: EditMode } | null;
}

/** The style of every point, one value per row, three for a colour. */
export interface PointStyle {
  /** The colour of each point, red, green and blue. */
  readonly colours: Float32Array;
  /** The diameter of each point, in CSS pixels. */
  readonly sizes: Float32Array;
  /** The code of each point's shape, in {@link SHAPES}. */
  readonly shapes: Float32Array;
  /** The mark of each point, a value of {@link MARK}. */
  readonly marks: Float32Array;
}

/**
 * The style of every point. With groups selected, the points of those
 * groups are drawn {@link SELECTED_GROUP_SCALE} times as large and the
 * others {@link OTHER_GROUP_SCALE} times; a point with a mark is drawn at
 * least as large as a selected group's, so that its colour shows inside its
 * ring; the hover is drawn larger still.
 *
 * @throws A defect when the codes or a set of rows is not of the table, or a
 * code has no colour.
 */
export function pointStyle(input: PointStyleInput): PointStyle {
  const { numRows, codes, selected, selection, hover, lasso } = input;
  const bytes = Math.ceil(numRows / 8);
  if (codes !== null && codes.length !== numRows) {
    throw defect(`codes of ${String(codes.length)} rows in a table of ${String(numRows)}`);
  }
  for (const set of [selection, lasso?.rows ?? null]) {
    if (set !== null && set.length !== bytes) {
      throw defect(`a set of ${String(set.length)} bytes for a table of ${String(numRows)} rows`);
    }
  }
  const colours = new Float32Array(3 * numRows);
  const sizes = new Float32Array(numRows);
  const shapes = new Float32Array(numRows);
  const marks = new Float32Array(numRows);
  const markedSize = POINT_SIZE_PX * SELECTED_GROUP_SCALE;
  const lassoMark = lasso?.mode === "remove" ? MARK.lassoRemove : MARK.lassoAdd;
  for (let row = 0; row < numRows; row += 1) {
    const code = codes === null ? NO_CODE : at(codes, row);
    const group = code === NO_CODE ? null : code;
    let colour = input.unclassified;
    if (codes !== null) {
      const own = group === null ? input.unassigned : input.groupColours[group];
      if (own === undefined) {
        throw defect(`group ${String(group)} of row ${String(row)} has no colour`);
      }
      colour = own;
      shapes[row] = group === null ? 0 : Math.floor(group / COLOURS_IN_LIST) % SHAPES.length;
    }
    colours.set(colour, 3 * row);
    let size = POINT_SIZE_PX;
    if (selected.length > 0) {
      size *= holdsCode(selected, group) ? SELECTED_GROUP_SCALE : OTHER_GROUP_SCALE;
    }
    if (lasso !== null && hasRow(lasso.rows, row)) {
      marks[row] = lassoMark;
      size = Math.max(size, markedSize);
    } else if (selection !== null && hasRow(selection, row)) {
      marks[row] = MARK.marked;
      size = Math.max(size, markedSize);
    }
    if (hover === row) {
      if (marks[row] === MARK.none) {
        marks[row] = MARK.marked;
      }
      size = Math.max(size, POINT_SIZE_PX * HOVER_SCALE);
    }
    sizes[row] = size;
  }
  return { colours, sizes, shapes, marks };
}

/** A colour as CSS writes it, `#rrggbb`, as the GPU takes it. */
export function rgbOf(css: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(css.trim());
  const hex = match?.[1];
  if (hex === undefined) {
    throw defect(`a colour ${css} not written as #rrggbb`);
  }
  const value = Number.parseInt(hex, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
