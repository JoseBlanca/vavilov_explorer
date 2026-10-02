// The reading of the layout every message of the backend shares
// (docs/core.md, section 5): the header of 24 bytes, the parts, and the
// numbers in them, each checked as it is read. decodeMessage.ts and
// decodeRows.ts read their parts with it.

import { defect } from "../state/defect.ts";
import { isColumnId, isHoverSeq, isLevelCode, isRevision, isRowIndex } from "../state/ids.ts";
import type { ColumnId, HoverSeq, LevelCode, Revision, RowIndex } from "../state/ids.ts";

const HEADER_BYTES = 24;
const PART_HEADER_BYTES = 8;
/** Every payload starts at a multiple of this, and is padded to one. */
export const ALIGNMENT = 8;

// A typed array reads in the platform's byte order; the messages are
// little-endian, which every platform of the app is.
if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw defect("the platform is not little-endian");
}

/** The header of a message, checked. */
export interface Header {
  /** Byte 0, the kind of message, for the caller to check. */
  readonly kind: number;
  /** The revision. */
  readonly revision: Revision;
  /** The time the sending window gave, or `null`. */
  readonly sentAt: number | null;
}

/** A part of a message: its kind, and where its payload is. */
export interface RawPart {
  /** The `u16` at the start of the part's header. */
  readonly kind: number;
  /** The offset of its payload in the message, a multiple of 8. */
  readonly start: number;
  /** The length of its payload, padding excluded. */
  readonly length: number;
}

/**
 * The header of a message and its parts, every length checked against the
 * bytes there are and every byte the layout says is zero checked.
 *
 * @throws A defect when the bytes are not a message of the layout.
 */
export function readMessage(
  bytes: ArrayBuffer,
  view: DataView,
): { readonly header: Header; readonly parts: readonly RawPart[] } {
  if (bytes.byteLength < HEADER_BYTES) {
    throw defect(`a message of ${String(bytes.byteLength)} bytes, shorter than its 24 of header`);
  }
  if (bytes.byteLength % ALIGNMENT !== 0) {
    throw defect(`a message of ${String(bytes.byteLength)} bytes, not a multiple of 8`);
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
  const header = { kind: view.getUint8(0), revision, sentAt: hasTime ? time : null };
  return { header, parts: readParts(bytes, view) };
}

function readParts(bytes: ArrayBuffer, view: DataView): RawPart[] {
  const parts: RawPart[] = [];
  let at = HEADER_BYTES;
  while (at < bytes.byteLength) {
    if (at + PART_HEADER_BYTES > bytes.byteLength) {
      throw defect(`a part's header beyond the message, at byte ${String(at)}`);
    }
    const kind = view.getUint16(at, true);
    expectZeros(view, at + 2, at + 4, "bytes 2 and 3 of a part's header");
    const length = view.getUint32(at + 4, true);
    const start = at + PART_HEADER_BYTES;
    const end = start + length;
    const padded = alignUp(end);
    if (padded > bytes.byteLength) {
      throw defect(`a part of ${String(length)} bytes at byte ${String(at)}, beyond the message`);
    }
    expectZeros(view, end, padded, "the padding of a part");
    parts.push({ kind, start, length });
    at = padded;
  }
  return parts;
}

/** The first multiple of 8 at or after `offset`. */
export function alignUp(offset: number): number {
  return Math.ceil(offset / ALIGNMENT) * ALIGNMENT;
}

/** The four zero bytes at `at + 4` and the revision at `at + 8`. */
export function zerosThenRevision(view: DataView, at: number): Revision {
  expectZeros(view, at + 4, at + 8, "the four bytes before a revision");
  return revisionAt(view, at + 8);
}

/** The revision, a `u64`, at `at`. */
export function revisionAt(view: DataView, at: number): Revision {
  const value = safeU64At(view, at);
  if (!isRevision(value)) {
    throw defect(`a revision of ${String(value)}`);
  }
  return value;
}

/** The hover's sequence number, a `u64`, at `at`. */
export function hoverSeqAt(view: DataView, at: number): HoverSeq {
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

/** A column id from the bytes, checked. */
export function columnId(value: number): ColumnId {
  if (!isColumnId(value)) {
    throw defect(`a column ${String(value)}`);
  }
  return value;
}

/** A level code from the bytes, checked. */
export function levelCode(value: number): LevelCode {
  if (!isLevelCode(value)) {
    throw defect(`a level code ${String(value)}`);
  }
  return value;
}

/** A row from the bytes, checked. */
export function rowIndex(value: number): RowIndex {
  if (!isRowIndex(value)) {
    throw defect(`a row ${String(value)}`);
  }
  return value;
}

/** A byte that is 0 or 1, in a part of `part`. */
export function booleanAt(view: DataView, at: number, part: string): boolean {
  const value = view.getUint8(at);
  if (value > 1) {
    throw defect(`a byte ${String(value)} for a yes or no in the ${part} part`);
  }
  return value === 1;
}

/** Checks the length of a part of fixed length. */
export function expectLength(part: string, length: number, expected: number): void {
  if (length !== expected) {
    throw defect(`a ${part} part of ${String(length)} bytes, not ${String(expected)}`);
  }
}

/** Checks that the bytes from `from` to `to` are zero. */
export function expectZeros(view: DataView, from: number, to: number, what: string): void {
  for (let at = from; at < to; at += 1) {
    if (view.getUint8(at) !== 0) {
      throw defect(
        `${what} should be zero, and byte ${String(at)} is ${String(view.getUint8(at))}`,
      );
    }
  }
}

// fatal, so that bytes that are not UTF-8 throw rather than turn into
// U+FFFD; ignoreBOM, so that a text that starts with U+FEFF keeps it.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * A text list of `count` texts that fills the `available` bytes at `at`: a
 * first offset of 0, the end of each text as a `u32`, then the texts.
 */
export function textList(
  bytes: ArrayBuffer,
  at: number,
  available: number,
  count: number,
): string[] {
  const offsetsLength = 4 * (count + 1);
  if (available < offsetsLength) {
    throw defect(
      `a text list of ${String(available)} bytes, shorter than the ${String(offsetsLength)} of the offsets of ${String(count)} rows`,
    );
  }
  const view = new DataView(bytes, at, offsetsLength);
  const firstOffset = view.getUint32(0, true);
  if (firstOffset !== 0) {
    throw defect(`a text list whose first offset is ${String(firstOffset)}`);
  }
  const textsAt = at + offsetsLength;
  const textsLength = available - offsetsLength;
  const ends: number[] = [];
  let previous = 0;
  for (let index = 1; index <= count; index += 1) {
    const end = view.getUint32(4 * index, true);
    if (end < previous) {
      throw defect(`an offset ${String(end)} after ${String(previous)} in a text list`);
    }
    ends.push(end);
    previous = end;
  }
  if (previous !== textsLength) {
    throw defect(
      `a text list whose texts end at ${String(previous)} and has ${String(textsLength)} bytes of them`,
    );
  }
  let start = 0;
  return ends.map((end) => {
    const text = utf8(new Uint8Array(bytes, textsAt + start, end - start));
    start = end;
    return text;
  });
}

function utf8(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      throw defect("a text list that is not UTF-8");
    }
    throw error;
  }
}
