// The decoder of a page of rows, the answer of fetch_rows (docs/core.md,
// section 5, "A page of rows"; crates/vavilov-core/src/rows.rs).

import { defect } from "../state/defect.ts";
import { MAX_ROWS, NO_CODE } from "../state/ids.ts";
import type { ColumnId, LevelCode } from "../state/ids.ts";
import type { PageColumn, RowPage } from "../state/rowPage.ts";
import {
  alignUp,
  booleanAt,
  columnId,
  expectLength,
  expectZeros,
  levelCode,
  readMessage,
  revisionAt,
  rowIndex,
} from "./layout.ts";
import type { RawPart } from "./layout.ts";

/** The kind of a message of rows, its byte 0. */
const ROWS = 3;
// The kinds of its parts (PartKind in crates/vavilov-core/src/message/mod.rs).
const PAGE = 8;
const NAMES = 9;
const VALUES = 10;
/** The type of a values part, by its byte. */
const TYPES = ["numeric", "integer", "text", "boolean", "categorical"] as const;
/** The bytes of a values part before its values. */
const VALUES_HEADER_BYTES = 16;

// fatal, so that bytes that are not UTF-8 throw rather than turn into
// U+FFFD; ignoreBOM, so that a name that starts with U+FEFF keeps it.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Decodes a page of rows into its names and values, each missing value as
 * `null`.
 *
 * @throws A defect when the bytes are not a page of the layout: a wrong
 * length, a byte that should be zero, a missing row that holds a value, an
 * offset that goes back or past the texts, a text that is not UTF-8. The
 * backend is our own code, so such a page is a bug.
 */
export function decodeRows(bytes: ArrayBuffer): RowPage {
  const view = new DataView(bytes);
  const { header, parts } = readMessage(bytes, view);
  if (header.kind !== ROWS) {
    throw defect(`a message of kind ${String(header.kind)} where rows were asked for`);
  }
  if (header.sentAt !== null) {
    throw defect(`a page of rows with the time ${String(header.sentAt)}`);
  }
  const [pagePart, namesPart, ...valuesParts] = parts;
  if (pagePart?.kind !== PAGE) {
    throw defect("a message of rows that does not start with its page part");
  }
  expectLength("page", pagePart.length, 16);
  const loadedAt = revisionAt(view, pagePart.start);
  const first = rowIndex(view.getUint32(pagePart.start + 8, true));
  const count = view.getUint32(pagePart.start + 12, true);
  if (first + count > MAX_ROWS) {
    throw defect(`a page of ${String(count)} rows from row ${String(first)}, past the table`);
  }
  if (namesPart?.kind !== NAMES) {
    throw defect("a message of rows with no names part after its page part");
  }
  const names = textList(bytes, namesPart.start, namesPart.length, count);
  const page = { view, first, count };
  const columns = valuesParts.map((part) => {
    if (part.kind !== VALUES) {
      throw defect(`a part of kind ${String(part.kind)} in a page of rows`);
    }
    return valuesPart(bytes, page, part);
  });
  return { revision: header.revision, loadedAt, first, count, names, columns };
}

/** Where a page's rows are, for the messages of its defects. */
interface Page {
  readonly view: DataView;
  readonly first: number;
  readonly count: number;
}

function valuesPart(bytes: ArrayBuffer, page: Page, part: RawPart): PageColumn {
  const { view, count } = page;
  if (part.length < VALUES_HEADER_BYTES) {
    throw defect(`a values part of ${String(part.length)} bytes`);
  }
  const id = columnId(view.getUint32(part.start, true));
  const typeByte = view.getUint8(part.start + 4);
  const type = TYPES[typeByte];
  if (type === undefined) {
    throw defect(`a values part of type ${String(typeByte)}`);
  }
  expectZeros(view, part.start + 5, part.start + 8, "bytes 5 to 7 of a values part");
  const revision = revisionAt(view, part.start + 8);
  const body = part.start + VALUES_HEADER_BYTES;
  const bodyLength = part.length - VALUES_HEADER_BYTES;
  if (type === "categorical") {
    expectValuesLength(part.length, 2 * count, typeByte);
    const codes = Array.from({ length: count }, (_, row): LevelCode | null => {
      const code = view.getUint16(body + 2 * row, true);
      return code === NO_CODE ? null : levelCode(code);
    });
    return { id, revision, type, codes };
  }
  const missing = missingRows(page, body, bodyLength);
  const values = body + alignUp(Math.ceil(count / 8));
  const valuesLength = part.start + part.length - values;
  const where = { page, id, missing, at: values };
  switch (type) {
    case "numeric":
      expectValuesLength(part.length, alignUp(Math.ceil(count / 8)) + 8 * count, typeByte);
      return {
        id,
        revision,
        type,
        values: eachRow(where, 8, (at, row) => {
          const value = view.getFloat64(at, true);
          if (!Number.isFinite(value)) {
            throw defect(`row ${String(row)} of column ${String(id)} holds ${String(value)}`);
          }
          return value;
        }),
      };
    case "integer":
      expectValuesLength(part.length, alignUp(Math.ceil(count / 8)) + 8 * count, typeByte);
      return {
        id,
        revision,
        type,
        values: eachRow(where, 8, (at) => view.getBigInt64(at, true)),
      };
    case "boolean":
      expectValuesLength(part.length, alignUp(Math.ceil(count / 8)) + count, typeByte);
      return {
        id,
        revision,
        type,
        values: eachRow(where, 1, (at) => booleanAt(view, at, "values")),
      };
    case "text": {
      const texts = textList(bytes, values, valuesLength, count);
      return {
        id,
        revision,
        type,
        values: texts.map((text, index) => {
          if (missing[index] !== true) {
            return text;
          }
          if (text !== "") {
            throw defect(
              `row ${String(page.first + index)} of column ${String(id)}, missing, holds a text of ${String(new TextEncoder().encode(text).length)} bytes`,
            );
          }
          return null;
        }),
      };
    }
  }
}

/** Where the values of a column are, and which of its rows are missing. */
interface ValuesAt {
  readonly page: Page;
  readonly id: ColumnId;
  readonly missing: readonly boolean[];
  readonly at: number;
}

/**
 * The value of each row, read by `read` from `width` bytes, or `null` for a
 * missing row, whose bytes must be zero.
 */
function eachRow<T>(
  { page, id, missing, at }: ValuesAt,
  width: number,
  read: (at: number, row: number) => T,
): (T | null)[] {
  return missing.map((isMissing, index) => {
    const start = at + width * index;
    const row = page.first + index;
    if (!isMissing) {
      return read(start, row);
    }
    for (let byte = start; byte < start + width; byte += 1) {
      if (page.view.getUint8(byte) !== 0) {
        throw defect(
          `row ${String(row)} of column ${String(id)}, missing, holds bytes that are not zero`,
        );
      }
    }
    return null;
  });
}

/**
 * Which rows of the page are missing, from one bit per row at `at`, set
 * when missing, then zeros to a multiple of 8 bytes.
 */
function missingRows(page: Page, at: number, available: number): boolean[] {
  const { view, count } = page;
  const numBytes = Math.ceil(count / 8);
  const padded = alignUp(numBytes);
  if (available < padded) {
    throw defect(
      `a values part of ${String(available)} bytes after its header, for ${String(count)} rows`,
    );
  }
  const used = count % 8;
  if (used !== 0 && (view.getUint8(at + numBytes - 1) & (0xff << used) & 0xff) !== 0) {
    throw defect(`a values part with a bit set beyond the ${String(count)} rows of the page`);
  }
  expectZeros(view, at + numBytes, at + padded, "the padding of the missing rows");
  return Array.from(
    { length: count },
    (_, row) => (view.getUint8(at + Math.floor(row / 8)) & (1 << (row % 8))) !== 0,
  );
}

/**
 * A text list of `count` texts that fills the `available` bytes at `at`: a
 * first offset of 0, the end of each text as a `u32`, then the texts.
 */
function textList(bytes: ArrayBuffer, at: number, available: number, count: number): string[] {
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

function expectValuesLength(length: number, valuesLength: number, typeByte: number): void {
  const expected = VALUES_HEADER_BYTES + valuesLength;
  if (length !== expected) {
    throw defect(
      `a values part of ${String(length)} bytes, not ${String(expected)}, for type ${String(typeByte)}`,
    );
  }
}
