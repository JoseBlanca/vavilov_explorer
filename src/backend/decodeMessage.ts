// The decoder of the messages of the backend, the one place that reads
// their bytes (docs/core.md, section 5; crates/vavilov-core/src/message/).
// Every number is little-endian; every payload starts at a multiple of 8, so
// the codes and the bits are read as typed arrays over the message, without
// a copy.

import { defect } from "../state/defect.ts";
import type { Comparison, Condition } from "../state/filter.ts";
import { MAX_ROWS, NO_COLUMN, NO_ROW, isLevelCode } from "../state/ids.ts";
import type { ColumnRevision, EditMode, Message, MessagePart, Selected } from "../state/message.ts";
import { countRows } from "../state/rowSet.ts";
import { removableGroups, singleOf } from "../state/selectedGroups.ts";
import {
  booleanAt,
  columnId,
  expectLength,
  expectZeros,
  hoverSeqAt,
  levelCode,
  readMessage,
  revisionAt,
  rowIndex,
  alignUp,
  textList,
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
const SHAPE = 11;
const FILTER = 13;
/** The bytes of a filter part before its text. */
const FILTER_HEADER_BYTES = 24;

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
    case ACTIVE:
      return activePart(view, start, length);
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
    case SHAPE:
      expectLength("shape", length, 8);
      return { kind: "shape", shapeAt: revisionAt(view, start) };
    case FILTER:
      return filterPart(bytes, view, start, length);
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

/** The comparisons of a filter part, by their byte. */
const COMPARISONS: readonly Comparison[] = ["less", "atMost", "equal", "atLeast", "greater"];

/** The code of a filter part that holds no group. */
const NO_GROUP = 0xffff;

/**
 * The filter part: the revision at which the rows shown last changed, their
 * number, the column searched, the kind of the condition, its comparison,
 * whether it is showing the rows that match or the others, whether bits
 * follow, whether its number cannot be read, a zero byte, the code of its
 * group, the text as a text list of one, and, when it does not show every
 * row, one bit per row after padding to a multiple of 8. Its bits are
 * checked against the rows of the table by the window's copy.
 */
function filterPart(
  bytes: ArrayBuffer,
  view: DataView,
  start: number,
  length: number,
): MessagePart {
  if (length < FILTER_HEADER_BYTES + 8) {
    throw defect(`a filter part of ${String(length)} bytes`);
  }
  const at = revisionAt(view, start);
  const numShown = view.getUint32(start + 8, true);
  const column = view.getUint32(start + 12, true);
  const kindByte = view.getUint8(start + 16);
  const comparisonByte = view.getUint8(start + 17);
  const showingByte = view.getUint8(start + 18);
  const filtered = booleanAt(view, start + 19, "filter");
  const unreadableNumber = booleanAt(view, start + 20, "filter's number");
  expectZeros(view, start + 21, start + 22, "byte 21 of the filter part");
  const groupCode = view.getUint16(start + 22, true);
  const showing = showingByte === 0 ? "matching" : showingByte === 1 ? "notMatching" : null;
  if (showing === null) {
    throw defect(`a filter part of showing ${String(showingByte)}`);
  }
  const textAt = start + FILTER_HEADER_BYTES;
  const textEnd = view.getUint32(textAt + 4, true);
  const textLength = 8 + textEnd;
  if (FILTER_HEADER_BYTES + textLength > length) {
    throw defect(`a filter part whose text of ${String(textEnd)} bytes goes past it`);
  }
  const [text] = textList(bytes, textAt, textLength, 1);
  if (text === undefined) {
    throw defect("a filter part with no text");
  }
  const condition = conditionOf(kindByte, comparisonByte, groupCode, text);
  const bitsAt = start + alignUp(FILTER_HEADER_BYTES + textLength);
  const end = start + length;
  let bits: Uint8Array | null = null;
  if (filtered) {
    if (bitsAt > end) {
      throw defect("a filter part with no room for its rows");
    }
    expectZeros(view, textAt + textLength, bitsAt, "the padding of the filter's text");
    bits = new Uint8Array(bytes, bitsAt, end - bitsAt);
    const set = countRows(bits);
    if (set !== numShown) {
      throw defect(`a filter part of ${String(numShown)} rows shown with ${String(set)} bits set`);
    }
  } else if (start + FILTER_HEADER_BYTES + textLength !== end) {
    throw defect("a filter part with bytes after its text and no rows");
  }
  return {
    kind: "filter",
    filter: { column: column === NO_COLUMN ? null : columnId(column), condition, showing },
    shown: { at, numShown, bits, unreadableNumber },
  };
}

/** The condition of a filter part, from its kind, its comparison, its group's code and its text. */
function conditionOf(
  kindByte: number,
  comparisonByte: number,
  groupCode: number,
  text: string,
): Condition {
  switch (kindByte) {
    case 0:
      return { kind: "contains", text };
    case 1:
      return { kind: "is", text };
    case 2: {
      if (groupCode === NO_GROUP) {
        return { kind: "group", code: null };
      }
      if (!isLevelCode(groupCode)) {
        throw defect(`a filter part of group ${String(groupCode)}`);
      }
      return { kind: "group", code: groupCode };
    }
    case 3: {
      const comparison = COMPARISONS[comparisonByte];
      if (comparison === undefined) {
        throw defect(`a filter part of comparison ${String(comparisonByte)}`);
      }
      return { kind: "compare", comparison, text };
    }
    case 4:
      return { kind: "missing" };
    default:
      throw defect(`a filter part of kind ${String(kindByte)}`);
  }
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
 * The active part: the column, `u32`, `NO_COLUMN` for none; the button
 * pressed, a byte, 0 none, 1 +, 2 −; whether the unassigned individuals
 * are selected, a byte, 0 or 1; the number of groups selected, `u16`; and
 * their codes, `u16` each, in ascending order.
 */
function activePart(view: DataView, start: number, length: number): MessagePart {
  if (length < 8) {
    throw defect(`an active part of ${String(length)} bytes`);
  }
  const column = view.getUint32(start, true);
  const modeByte = view.getUint8(start + 4);
  const unassignedByte = view.getUint8(start + 5);
  const numGroups = view.getUint16(start + 6, true);
  expectLength("active", length, 8 + 2 * numGroups);
  if (unassignedByte !== 0 && unassignedByte !== 1) {
    throw defect(`an active part whose unassigned byte is ${String(unassignedByte)}`);
  }
  const selected: Selected[] = [];
  let previous = -1;
  for (let index = 0; index < numGroups; index += 1) {
    const code = view.getUint16(start + 8 + 2 * index, true);
    if (code <= previous) {
      throw defect(`an active part whose codes are not in ascending order: ${String(code)}`);
    }
    previous = code;
    selected.push({ kind: "group", code: levelCode(code) });
  }
  if (unassignedByte === 1) {
    selected.push({ kind: "unassigned" });
  }
  if (column === NO_COLUMN && selected.length > 0) {
    throw defect("an active part with groups selected and no classification");
  }
  return {
    kind: "active",
    column: column === NO_COLUMN ? null : columnId(column),
    selected,
    mode: modeOf(modeByte, selected),
  };
}

/**
 * The button pressed, 0 none, 1 +, 2 −: + needs exactly one row selected,
 * and − a group among them.
 */
function modeOf(kind: number, selected: readonly Selected[]): EditMode | null {
  if (kind === 0) {
    return null;
  }
  if (kind === 1 && singleOf(selected) !== null) {
    return "add";
  }
  if (kind === 2 && removableGroups(selected).length > 0) {
    return "remove";
  }
  throw defect(`a button pressed of kind ${String(kind)} on ${String(selected.length)} rows`);
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
