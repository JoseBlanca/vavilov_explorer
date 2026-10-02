// The window's copy of the backend's shared state, made from a snapshot and
// kept up to date by every message after it (.claude/skills/coding/frontend.md,
// "The window's copy of the state"; docs/core.md, section 5).

import { defect } from "./defect.ts";
import type { ColumnId, HoverSeq, Revision, RowIndex } from "./ids.ts";
import type { Message, MessagePart, Selected, UndoRedo } from "./message.ts";

/** What changes together, so that a component redraws only for what it shows. */
export type Aspect = "table" | "classification" | "codes" | "selection" | "hover" | "undoRedo";

/** Whether a project is open, and its number of rows. */
export type ProjectState =
  | { readonly kind: "noProject" }
  | { readonly kind: "open"; readonly numRows: number; readonly loadedAt: Revision };

/** The active classification and its selected population, as `Active` in the core. */
export interface Active {
  /** The column of the active classification. */
  readonly column: ColumnId;
  /** What is selected for editing, or `null`. */
  readonly selected: Selected | null;
}

/** The window's copy of the shared state. */
export interface WindowState {
  /** The revision of the last change applied. */
  readonly revision: () => Revision;
  /** Whether a project is open. */
  readonly project: () => ProjectState;
  /**
   * The revision at which the columns, their names or their roles last
   * changed, or `null` with no project; the window asks for the description
   * of the table again when it grows.
   */
  readonly shapeAt: () => Revision | null;
  /** The active classification, or `null` for none. */
  readonly active: () => Active | null;
  /** The codes of a categorical column, `NO_CODE` for missing, or `null` for a column that has none. */
  readonly codes: (column: ColumnId) => Uint16Array | null;
  /** The revision at which a column last changed, or `null` for a column not in the table. */
  readonly columnRevision: (column: ColumnId) => Revision | null;
  /** The selection, one bit per row, or `null` with no project. */
  readonly selection: () => Uint8Array | null;
  /** The individual under the pointer. */
  readonly hover: () => RowIndex | null;
  /** Whether there is something to undo and something to redo. */
  readonly undoRedo: () => UndoRedo;
  /**
   * Applies a message of the channel: a change one revision after the last,
   * or a hover. A change at or before the current revision is already in the
   * copy and is dropped, and so is a hover not newer than the last one.
   *
   * @throws A defect for a change that skips a revision, a snapshot, or a
   * part that does not fit the copy, such as codes of another length than
   * the table's rows.
   */
  readonly apply: (message: Message) => void;
  /** Calls `listener` after each message that changes `aspect`; returns the function that stops it. */
  readonly subscribe: (aspect: Aspect, listener: () => void) => () => void;
}

/** The aspects in the order their listeners are called. */
const ASPECTS: readonly Aspect[] = [
  "table",
  "classification",
  "codes",
  "selection",
  "hover",
  "undoRedo",
];

/** Everything the copy holds; a message builds a new one and keeps it only when every part fits. */
interface Copy {
  readonly revision: Revision;
  readonly project: ProjectState;
  readonly shapeAt: Revision | null;
  readonly active: Active | null;
  readonly codes: ReadonlyMap<ColumnId, Uint16Array>;
  readonly columns: ReadonlyMap<ColumnId, Revision>;
  readonly selection: Uint8Array | null;
  readonly hover: RowIndex | null;
  readonly hoverSeq: HoverSeq;
  readonly undoRedo: UndoRedo;
}

/**
 * The copy of the state of a snapshot.
 *
 * @throws A defect when the message is not a snapshot of the whole state.
 */
export function createWindowState(snapshot: Message): WindowState {
  if (snapshot.kind !== "snapshot") {
    throw defect(`a window's state made from a ${snapshot.kind} message`);
  }
  const first = snapshot.parts[0];
  if (first?.kind !== "project" && first?.kind !== "noProject") {
    throw defect("a snapshot that does not start with its project part");
  }
  const hoverPart = snapshot.parts.find((part) => part.kind === "hover");
  if (hoverPart?.kind !== "hover") {
    throw defect("a snapshot without its hover part");
  }
  let copy = withParts(empty(snapshot.revision, first, hoverPart.seq), snapshot).copy;
  const listeners = new Map<Aspect, Set<() => void>>(ASPECTS.map((aspect) => [aspect, new Set()]));

  function notify(changed: ReadonlySet<Aspect>): void {
    for (const aspect of ASPECTS) {
      if (changed.has(aspect)) {
        const set = listeners.get(aspect);
        if (set === undefined) {
          throw defect(`an aspect ${aspect} with no listeners`);
        }
        for (const listener of set) {
          listener();
        }
      }
    }
  }

  function apply(message: Message): void {
    switch (message.kind) {
      case "snapshot":
        throw defect("a snapshot applied to a window's state; a new subscribe makes a new state");
      case "hover": {
        const [part] = message.parts;
        if (part?.kind !== "hover") {
          throw defect("a hover message without its hover part");
        }
        if (part.seq <= copy.hoverSeq) {
          return;
        }
        checkRow(copy.project, part.row);
        copy = { ...copy, hover: part.row, hoverSeq: part.seq };
        notify(new Set(["hover"]));
        return;
      }
      case "change": {
        if (message.revision <= copy.revision) {
          return;
        }
        if (message.revision !== copy.revision + 1) {
          throw defect(
            `a change at revision ${String(message.revision)} after revision ${String(copy.revision)}: revision ${String(copy.revision + 1)} is missing`,
          );
        }
        const loaded = message.parts.find(
          (part) => part.kind === "project" || part.kind === "noProject",
        );
        const start = loaded === undefined ? copy : empty(copy.revision, loaded, copy.hoverSeq);
        const next = withParts(start, message);
        copy = { ...next.copy, revision: message.revision };
        notify(loaded === undefined ? next.changed : new Set(ASPECTS));
        return;
      }
    }
  }

  return {
    revision: () => copy.revision,
    project: () => copy.project,
    shapeAt: () => copy.shapeAt,
    active: () => copy.active,
    codes: (column) => copy.codes.get(column) ?? null,
    columnRevision: (column) => copy.columns.get(column) ?? null,
    selection: () => copy.selection,
    hover: () => copy.hover,
    undoRedo: () => copy.undoRedo,
    apply,
    subscribe: (aspect, listener) => {
      const set = listeners.get(aspect);
      if (set === undefined) {
        throw defect(`an aspect ${aspect} with no listeners`);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
}

/** The copy of a project just loaded, or of no project, before its other parts. */
function empty(revision: Revision, project: MessagePart, hoverSeq: HoverSeq): Copy {
  return {
    revision,
    project:
      project.kind === "project"
        ? { kind: "open", numRows: project.numRows, loadedAt: project.loadedAt }
        : { kind: "noProject" },
    shapeAt: null,
    active: null,
    codes: new Map(),
    columns: new Map(),
    selection: null,
    hover: null,
    hoverSeq,
    undoRedo: { canUndo: false, canRedo: false },
  };
}

/**
 * The copy with the parts of `message` applied, and the aspects they
 * changed. The copy given is not changed, so a defect leaves it whole.
 */
function withParts(copy: Copy, message: Message): { copy: Copy; changed: Set<Aspect> } {
  let project = copy.project;
  let shapeAt = copy.shapeAt;
  let active = copy.active;
  const codes = new Map(copy.codes);
  const columns = new Map(copy.columns);
  let selection = copy.selection;
  let hover = copy.hover;
  let hoverSeq = copy.hoverSeq;
  let undoRedo = copy.undoRedo;
  const changed = new Set<Aspect>();
  for (const part of message.parts) {
    switch (part.kind) {
      case "noProject":
        project = { kind: "noProject" };
        changed.add("table");
        break;
      case "project":
        project = { kind: "open", numRows: part.numRows, loadedAt: part.loadedAt };
        changed.add("table");
        break;
      case "active":
        active = part.column === null ? null : { column: part.column, selected: part.selected };
        changed.add("classification");
        break;
      case "selection":
        if (part.numRows !== rowsOf(project, "a selection")) {
          throw defect(
            `a selection of ${String(part.numRows)} rows for a table of ${String(rowsOf(project, "a selection"))}`,
          );
        }
        selection = part.bits;
        changed.add("selection");
        break;
      case "codes":
        if (part.codes.length !== rowsOf(project, "codes")) {
          throw defect(
            `${String(part.codes.length)} codes of column ${String(part.column)} for a table of ${String(rowsOf(project, "codes"))} rows`,
          );
        }
        codes.set(part.column, part.codes);
        changed.add("codes");
        break;
      case "columns":
        rowsOf(project, "the revisions of columns");
        for (const { column, revision } of part.columns) {
          columns.set(column, revision);
        }
        changed.add("table");
        break;
      case "undo":
        undoRedo = { canUndo: part.canUndo, canRedo: part.canRedo };
        changed.add("undoRedo");
        break;
      case "hover":
        checkRow(project, part.row);
        hover = part.row;
        hoverSeq = part.seq;
        changed.add("hover");
        break;
      case "shape":
        rowsOf(project, "the shape of the table");
        shapeAt = part.shapeAt;
        changed.add("table");
        break;
    }
  }
  // A column listed with no codes beside it is no longer a category or a
  // classification (docs/core.md, section 5), and its codes go.
  const withCodes = new Set(
    message.parts.flatMap((part) => (part.kind === "codes" ? [part.column] : [])),
  );
  for (const part of message.parts) {
    if (part.kind === "columns") {
      for (const { column } of part.columns) {
        if (!withCodes.has(column) && codes.delete(column)) {
          changed.add("codes");
        }
      }
    }
  }
  if (active !== null && !codes.has(active.column)) {
    throw defect(`an active classification, column ${String(active.column)}, with no codes`);
  }
  return {
    copy: {
      ...copy,
      project,
      shapeAt,
      active,
      codes,
      columns,
      selection,
      hover,
      hoverSeq,
      undoRedo,
    },
    changed,
  };
}

/** The number of rows of the open project, for a part that needs one. */
function rowsOf(project: ProjectState, what: string): number {
  if (project.kind === "noProject") {
    throw defect(`${what} with no project open`);
  }
  return project.numRows;
}

function checkRow(project: ProjectState, row: RowIndex | null): void {
  if (row !== null && row >= rowsOf(project, "a hover")) {
    throw defect(
      `a hover on row ${String(row)} of a table of ${String(rowsOf(project, "a hover"))} rows`,
    );
  }
}
