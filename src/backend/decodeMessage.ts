// The decoder of the messages of the backend, the one place that reads
// their bytes (docs/core.md, section 5; crates/vavilov-core/src/message/).
// Every number is little-endian; every payload starts at a multiple of 8, so
// the codes and the bits are read as typed arrays over the message, without
// a copy.

import { defect } from "../state/defect.ts";
import {
  MAX_ROWS,
  NO_CODE,
  NO_COLUMN,
  NO_ROW,
  isColumnId,
  isHoverSeq,
  isLevelCode,
  isRevision,
  isRowIndex,
} from "../state/ids.ts";
import type { ColumnId, HoverSeq, LevelCode, Revision, RowIndex } from "../state/ids.ts";
import type { ColumnRevision, Message, MessagePart, Selected } from "../state/message.ts";

const HEADER_BYTES = 24;
const PART_HEADER_BYTES = 8;
const ALIGNMENT = 8;
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

// A typed array reads in the platform's byte order; the messages are
// little-endian, which every platform of the app is.
if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw defect("the platform is not little-endian");
}

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
  if (bytes.byteLength < HEADER_BYTES) {
    throw defect(`a message of ${String(bytes.byteLength)} bytes, shorter than its 24 of header`);
  }
  if (bytes.byteLength % ALIGNMENT !== 0) {
    throw defect(`a message of ${String(bytes.byteLength)} bytes, not a multiple of 8`);
  }
  const view = new DataView(bytes);
  const kind = MESSAGE_KINDS[view.getUint8(0)];
  if (kind === undefined) {
    throw defect(`a kind of message ${String(view.getUint8(0))}`);
  }
  const flags = view.getUint8(1);
  if ((flags & 0b1111_1110) !== 0) {
    throw defect(`flags ${String(flags)} in a message`);
  }
  expectZeros(view, 2, 8, "bytes 2 to 7 of a message");
  const revision = revisionAt(view, 8);
  const time = view.getFloat64(16, true);
  const hasTime = flags === 1;
  if (hasTime ? !Number.isFinite(time) : !Object.is(time, 0)) {
    throw defect(`a time of ${String(time)} in a message whose flags are ${String(flags)}`);
  }
  const parts = decodeParts(bytes, view);
  checkShape(kind, parts);
  return { kind, revision, sentAt: hasTime ? time : null, parts };
}

function decodeParts(bytes: ArrayBuffer, view: DataView): MessagePart[] {
  const parts: MessagePart[] = [];
  let at = HEADER_BYTES;
  while (at < bytes.byteLength) {
    if (at + PART_HEADER_BYTES > bytes.byteLength) {
      throw defect(`a part's header beyond the message, at byte ${String(at)}`);
    }
    const partKind = view.getUint16(at, true);
    expectZeros(view, at + 2, at + 4, "bytes 2 and 3 of a part's header");
    const length = view.getUint32(at + 4, true);
    const start = at + PART_HEADER_BYTES;
    const end = start + length;
    const padded = Math.ceil(end / ALIGNMENT) * ALIGNMENT;
    if (padded > bytes.byteLength) {
      throw defect(`a part of ${String(length)} bytes at byte ${String(at)}, beyond the message`);
    }
    expectZeros(view, end, padded, "the padding of a part");
    parts.push(decodePart(partKind, bytes, view, start, length));
    at = padded;
  }
  return parts;
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

/** The four zero bytes at `at + 4` and the revision at `at + 8`. */
function zerosThenRevision(view: DataView, at: number): Revision {
  expectZeros(view, at + 4, at + 8, "the four bytes before a revision");
  return revisionAt(view, at + 8);
}

function revisionAt(view: DataView, at: number): Revision {
  const value = safeU64At(view, at);
  if (!isRevision(value)) {
    throw defect(`a revision of ${String(value)}`);
  }
  return value;
}

function hoverSeqAt(view: DataView, at: number): HoverSeq {
  const value = safeU64At(view, at);
  if (!isHoverSeq(value)) {
    throw defect(`a hover's sequence number of ${String(value)}`);
  }
  return value;
}

/** A `u64` that a number holds exactly, at most 2^53 − 1. */
function safeU64At(view: DataView, at: number): number {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw defect(`a value of ${value.toString()}, past 2^53 - 1`);
  }
  return Number(value);
}

function columnId(value: number): ColumnId {
  if (!isColumnId(value)) {
    throw defect(`a column ${String(value)}`);
  }
  return value;
}

function levelCode(value: number): LevelCode {
  if (!isLevelCode(value)) {
    throw defect(`a level code ${String(value)}`);
  }
  return value;
}

function rowIndex(value: number): RowIndex {
  if (!isRowIndex(value)) {
    throw defect(`a row ${String(value)}`);
  }
  return value;
}

function booleanAt(view: DataView, at: number, part: string): boolean {
  const value = view.getUint8(at);
  if (value > 1) {
    throw defect(`a byte ${String(value)} for a yes or no in the ${part} part`);
  }
  return value === 1;
}

function expectLength(part: string, length: number, expected: number): void {
  if (length !== expected) {
    throw defect(`a ${part} part of ${String(length)} bytes, not ${String(expected)}`);
  }
}

function expectZeros(view: DataView, from: number, to: number, what: string): void {
  for (let at = from; at < to; at += 1) {
    if (view.getUint8(at) !== 0) {
      throw defect(
        `${what} should be zero, and byte ${String(at)} is ${String(view.getUint8(at))}`,
      );
    }
  }
}
