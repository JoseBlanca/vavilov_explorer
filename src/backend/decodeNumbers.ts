// The decoder of a message of numbers, the answer of fetch_column
// (crates/vavilov-core/src/numbers.rs): the header, then one part with the
// column, its revision, its rows, the middle of its values, which are
// missing, and an f32 per row, its distance from the middle.

import type { ColumnNumbers } from "../state/columnNumbers.ts";
import { defect } from "../state/defect.ts";
import { MAX_ROWS } from "../state/ids.ts";
import { hasRow } from "../state/rowSet.ts";
import { alignUp, columnId, expectLength, expectZeros, readMessage, revisionAt } from "./layout.ts";

/** The kind of a message of numbers, its byte 0. */
const NUMBERS_MESSAGE = 5;
/** The kind of its part. */
const NUMBERS_PART = 14;
/** The bytes of the part before the bits of the missing rows. */
const PART_HEADER_BYTES = 32;

/**
 * Decodes a message of numbers. The values and the bits are views on
 * `bytes`, not copies.
 *
 * @throws A defect when the bytes are not such a message: a wrong length, a
 * byte that should be zero, a missing row that holds a value, a NaN. The
 * backend is our own code, so such a message is a bug.
 */
export function decodeNumbers(bytes: ArrayBuffer): ColumnNumbers {
  const view = new DataView(bytes);
  const { header, parts } = readMessage(bytes, view);
  const [part, ...rest] = parts;
  if (header.kind !== NUMBERS_MESSAGE || part?.kind !== NUMBERS_PART || rest.length > 0) {
    throw defect(`a message of kind ${String(header.kind)} that is not one numbers part`);
  }
  if (header.sentAt !== null) {
    throw defect(`a message of numbers with the time ${String(header.sentAt)}`);
  }
  if (part.length < PART_HEADER_BYTES) {
    throw defect(`a numbers part of ${String(part.length)} bytes`);
  }
  const column = columnId(view.getUint32(part.start, true));
  expectZeros(view, part.start + 4, part.start + 8, "bytes 4 to 7 of a numbers part");
  const revision = revisionAt(view, part.start + 8);
  const numRows = view.getUint32(part.start + 16, true);
  if (numRows > MAX_ROWS) {
    throw defect(`a numbers part of ${String(numRows)} rows`);
  }
  expectZeros(view, part.start + 20, part.start + 24, "bytes 20 to 23 of a numbers part");
  const centre = view.getFloat64(part.start + 24, true);
  if (!Number.isFinite(centre)) {
    throw defect(`a numbers part with the middle of ${String(centre)}`);
  }
  const bitsAt = part.start + PART_HEADER_BYTES;
  const bitsLength = Math.ceil(numRows / 8);
  const valuesAt = alignUp(bitsAt + bitsLength);
  expectLength("numbers", part.length, valuesAt - part.start + 4 * numRows);
  expectZeros(view, bitsAt + bitsLength, valuesAt, "the padding after the missing rows");
  const missing = new Uint8Array(bytes, bitsAt, bitsLength);
  const unused = numRows % 8;
  const last = missing[bitsLength - 1];
  if (unused !== 0 && last !== undefined && last >> unused !== 0) {
    throw defect("a numbers part with a missing row past its last row");
  }
  const values = new Float32Array(bytes, valuesAt, numRows);
  values.forEach((value, row) => {
    const isMissing = hasRow(missing, row);
    if (Number.isNaN(value) || (isMissing && !Object.is(value, 0))) {
      throw defect(`row ${String(row)} of a numbers part holds ${String(value)}`);
    }
  });
  return { column, revision, centre, values, missing };
}
