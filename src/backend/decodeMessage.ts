// The decoder of the messages of the backend, the one place that reads
// their bytes (docs/core.md, section 5; crates/vavilov-core/src/message/).
// Every number is little-endian; every payload starts at a multiple of 8, so
// the codes and the bits are read as typed arrays over the message, without
// a copy.

import { defect } from "../state/defect.ts";
import { MAX_ROWS, NO_CODE, NO_COLUMN, NO_ROW } from "../state/ids.ts";
import type { ColumnRevision, Message, MessagePart, Selected } from "../state/message.ts";
import {
  booleanAt,
  columnId,
  expectLength,
  expectZeros,
  hoverSeqAt,
  levelCode,
  readMessage,
  rowIndex,
  zerosThenRevision,
} from "./layout.ts";

const MESSAGE_KINDS = ["snapshot", "change", "hover"] as const;

// The kinds of part, the u16 at the start of a part's header (PartKind in
// crates/vavilov-core/src/message/mod.rs).
const PROJECT = 1;
const ACTIVE = 2;
const SELECTION = 3;
const CODES = 4;
const UNDO = 5;
const COLUMNS = 6;
const HOVER = 7;

/**
 * Decodes one message of the backend: a channel's message or the snapshot a
 * subscribe returns. The codes and the bits of the parts are views into
 * `bytes`, which must not be changed afterwards.
 *
 * @throws A defect when the bytes are not a message of the layout: a wrong
 * length, a byte that should be zero, an unknown kind, a value out of its
 * range. The backend is our own code, so such a message is a bug.
 */
export function decodeMessage(bytes: ArrayBuffer): Message {
  const view = new DataView(bytes);
  const { header, parts: rawParts } = readMessage(bytes, view);
  const kind = MESSAGE_KINDS[header.kind];
  if (kind === undefined) {
    throw defect(`a kind of message ${String(header.kind)}`);
  }
  const parts = rawParts.map((part) => decodePart(part.kind, bytes, view, part.start, part.length));
  checkShape(kind, parts);
  return { kind, revision: header.revision, sentAt: header.sentAt, parts };
}

function decodePart(
  partKind: number,
  bytes: ArrayBuffer,
  view: DataView,
  start: number,
  length: number,
): MessagePart {
  switch (partKind) {
    case PROJECT:
      return projectPart(view, start, length);
    case ACTIVE: {
      expectLength("active", length, 7);
      const column = view.getUint32(start, true);
      const code = view.getUint16(start + 4, true);
      return {
        kind: "active",
        column: column === NO_COLUMN ? null : columnId(column),
        selected: selectedOf(view.getUint8(start + 6), code),
      };
    }
    case SELECTION:
      return selectionPart(bytes, view, start, length);
    case CODES: {
      if (length < 16 || (length - 16) % 2 !== 0) {
        throw defect(`a codes part of ${String(length)} bytes`);
      }
      return {
        kind: "codes",
        column: columnId(view.getUint32(start, true)),
        revision: zerosThenRevision(view, start),
        codes: new Uint16Array(bytes, start + 16, (length - 16) / 2),
      };
    }
    case UNDO: {
      expectLength("undo", length, 2);
      return {
        kind: "undo",
        canUndo: booleanAt(view, start, "undo"),
        canRedo: booleanAt(view, start + 1, "undo"),
      };
    }
    case COLUMNS:
      return columnsPart(view, start, length);
    case HOVER: {
      expectLength("hover", length, 12);
      const row = view.getUint32(start + 8, true);
      return {
        kind: "hover",
        seq: hoverSeqAt(view, start),
        row: row === NO_ROW ? null : rowIndex(row),
      };
    }
    default:
      throw defect(`a kind of part ${String(partKind)}`);
  }
}

function projectPart(view: DataView, start: number, length: number): MessagePart {
  if (length !== 8 && length !== 24) {
    throw defect(`a project part of ${String(length)} bytes`);
  }
  const open = booleanAt(view, start, "project");
  expectZeros(view, start + 1, start + 8, "bytes 1 to 7 of the project part");
  if (!open) {
    expectLength("project, with none open,", length, 8);
    return { kind: "noProject" };
  }
  expectLength("project, with one open,", length, 24);
  const numRows = view.getUint32(start + 8, true);
  if (numRows > MAX_ROWS) {
    throw defect(
      `a project of ${String(numRows)} rows, more than the ${String(MAX_ROWS)} of the core`,
    );
  }
  return {
    kind: "project",
    numRows,
    loadedAt: zerosThenRevision(view, start + 8),
  };
}

function selectionPart(
  bytes: ArrayBuffer,
  view: DataView,
  start: number,
  length: number,
): MessagePart {
  if (length < 8) {
    throw defect(`a selection part of ${String(length)} bytes`);
  }
  const numRows = view.getUint32(start, true);
  expectZeros(view, start + 4, start + 8, "bytes 4 to 7 of the selection part");
  expectLength("selection", length, 8 + Math.ceil(numRows / 8));
  const bits = new Uint8Array(bytes, start + 8, length - 8);
  const used = numRows % 8;
  const last = bits.at(-1);
  if (used !== 0 && last !== undefined && (last & (0xff << used) & 0xff) !== 0) {
    throw defect(`a selection of ${String(numRows)} rows with a bit beyond the last row`);
  }
  return { kind: "selection", numRows, bits };
}

function columnsPart(view: DataView, start: number, length: number): MessagePart {
  if (length < 8) {
    throw defect(`a columns part of ${String(length)} bytes`);
  }
  const numColumns = view.getUint32(start, true);
  expectZeros(view, start + 4, start + 8, "bytes 4 to 7 of the columns part");
  expectLength("columns", length, 8 + 16 * numColumns);
  const columns: ColumnRevision[] = [];
  for (let at = start + 8; at < start + length; at += 16) {
    columns.push({
      column: columnId(view.getUint32(at, true)),
      revision: zerosThenRevision(view, at),
    });
  }
  return { kind: "columns", columns };
}

/**
 * What is selected, from the kind byte of the active part, 0 nothing, 1 a
 * population, 2 the unassigned individuals, and the code, `NO_CODE` but
 * for a population.
 */
function selectedOf(kind: number, code: number): Selected | null {
  if (kind === 1) {
    return { kind: "population", code: levelCode(code) };
  }
  if (code !== NO_CODE) {
    throw defect(
      `a code ${String(code)} in an active part whose selection is of kind ${String(kind)}`,
    );
  }
  if (kind === 0) {
    return null;
  }
  if (kind === 2) {
    return { kind: "unassigned" };
  }
  throw defect(`a kind of selection ${String(kind)}`);
}

/** Checks what a message of each kind must hold. */
function checkShape(kind: Message["kind"], parts: readonly MessagePart[]): void {
  switch (kind) {
    case "hover":
      if (parts.length !== 1 || parts[0]?.kind !== "hover") {
        throw defect(`a hover message of ${String(parts.length)} parts, not one hover part`);
      }
      return;
    case "snapshot": {
      const first = parts[0]?.kind;
      if (first !== "project" && first !== "noProject") {
        throw defect("a snapshot that does not start with its project part");
      }
      return;
    }
    case "change":
      return;
  }
}
