// A message from the backend, decoded: its kind, its revision and its
// parts (docs/core.md, section 5). src/backend/decodeMessage.ts makes them.

import type { Filter, Shown } from "./filter.ts";
import type { ColumnId, HoverSeq, LevelCode, Revision, RowIndex } from "./ids.ts";

/** One part of a message: a piece of the shared state. */
export type MessagePart =
  /** No project is open. */
  | { readonly kind: "noProject" }
  /** A project is open, with its number of rows and the revision of its load. */
  | { readonly kind: "project"; readonly numRows: number; readonly loadedAt: Revision }
  /**
   * The active classification, what is selected in it, and the button
   * pressed on that, each `null` for none.
   */
  | {
      readonly kind: "active";
      readonly column: ColumnId | null;
      readonly selected: Selected | null;
      readonly mode: EditMode | null;
    }
  /**
   * The selection, one bit per row: row `i` is bit `i % 8` of byte `i / 8`, and
   * the bits beyond the last row are zero.
   */
  | { readonly kind: "selection"; readonly numRows: number; readonly bits: Uint8Array }
  /**
   * The codes of a categorical column, one per row, `NO_CODE` of `ids.ts` for a
   * missing value, a view into the message's bytes.
   */
  | {
      readonly kind: "codes";
      readonly column: ColumnId;
      readonly revision: Revision;
      readonly codes: Uint16Array;
    }
  /** Whether there is something to undo and something to redo. */
  | ({ readonly kind: "undo" } & UndoRedo)
  /** The revision of each column listed, so that a window fetches again those that changed. */
  | { readonly kind: "columns"; readonly columns: readonly ColumnRevision[] }
  /** The individual under the pointer, `null` for none, and its sequence number. */
  | { readonly kind: "hover"; readonly seq: HoverSeq; readonly row: RowIndex | null }
  /**
   * The revision at which the columns, their names or their roles last
   * changed, so that a window asks for the description of the table again.
   */
  | { readonly kind: "shape"; readonly shapeAt: Revision }
  /** The filter of the find bar and the rows it shows. */
  | { readonly kind: "filter"; readonly filter: Filter; readonly shown: Shown };

/**
 * What is selected for editing in the active classification, as `Selected`
 * in the core: a group, or its unassigned individuals.
 */
export type Selected =
  { readonly kind: "group"; readonly code: LevelCode } | { readonly kind: "unassigned" };

/**
 * The button pressed on what is selected for editing, as `EditMode` in the
 * core: + puts the individuals that enter the selection in it, and − takes
 * out of it those that are in it (docs/design.md, section 2.1).
 */
export type EditMode = "add" | "remove";

/** Whether there is something to undo and something to redo, as `UndoRedo` in the core. */
export interface UndoRedo {
  /** Whether there is an edit to undo. */
  readonly canUndo: boolean;
  /** Whether there is an edit to redo. */
  readonly canRedo: boolean;
}

/** A column and the revision at which it last changed. */
export interface ColumnRevision {
  /** The column. */
  readonly column: ColumnId;
  /** The revision of the session at which it last changed. */
  readonly revision: Revision;
}

/**
 * A message from the backend. A snapshot is the whole shared state, the
 * response of a subscribe; a change is what one command changed, one revision
 * after the last; a hover takes no revision, and its header has the current
 * one, which plays no part in the order.
 */
export interface Message {
  /** What the message is. */
  readonly kind: "snapshot" | "change" | "hover";
  /** The revision of the session the message is at. */
  readonly revision: Revision;
  /** The time the sending window gave with its command, in milliseconds, or `null`. */
  readonly sentAt: number | null;
  /** The parts, in the order they were sent. */
  readonly parts: readonly MessagePart[];
}
