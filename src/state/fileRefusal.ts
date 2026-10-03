// Why a file was not imported or exported, as the core's ImportRefusal and
// ExportRefusal cross to a window inside a refusal (crates/vavilov-core/
// src/error/file.rs): a kind and its fields, in camelCase. The tables below
// are the one list of them on this side, and the types are made from them.

import { isCount, isText, oneOf, taggedDecoder } from "./tagged.ts";
import type { Tagged } from "./tagged.ts";

/** The format a file was read as: its places are lines, or rows and columns of a sheet. */
export type FileFormat = "text" | "xlsx";

/** The character between the cells of a text file. */
export type Separator = "tab" | "semicolon" | "comma";

const isFormat = oneOf<FileFormat>(["text", "xlsx"]);
const isSeparator = oneOf<Separator>(["tab", "semicolon", "comma"]);

/** The individual of a cell, `null` for the header. */
function isIndividual(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** One character, one code point, as Rust serialises a `char`. */
function isCharacter(value: unknown): value is string {
  return typeof value === "string" && /^[\s\S]$/u.test(value);
}

/** The fields of each kind of refusal of an import. */
const IMPORT_FIELDS = {
  tooLarge: { size: isCount, maxBytes: isCount },
  oldExcel: {},
  encrypted: {},
  notWorkbook: {},
  emptySheet: { sheet: isText },
  cellError: { error: isText },
  sheetTooLarge: {
    sheet: isText,
    firstRow: isCount,
    firstColumn: isCount,
    numRows: isCount,
    numColumns: isCount,
    maxCells: isCount,
  },
  cutShort: {},
  notText: {},
  variantsFile: {},
  unclosedQuote: { line: isCount, separator: isSeparator },
  headerError: { row: isCount, column: isCount, error: isText },
  empty: {},
  unnamedColumn: { format: isFormat, column: isCount },
  raggedRow: { line: isCount, expected: isCount, found: isCount, separator: isSeparator },
  duplicateColumn: {
    format: isFormat,
    name: isText,
    firstColumn: isCount,
    secondColumn: isCount,
  },
  emptyIndividual: { format: isFormat, row: isCount },
  duplicateIndividual: {
    format: isFormat,
    name: isText,
    firstRow: isCount,
    secondRow: isCount,
  },
  individualWrittenTwoWays: { name: isText },
  columnWrittenTwoWays: { name: isText },
  notIndividualId: { header: isText },
  namedIndividualId: { format: isFormat, column: isCount },
};

/** The fields of each kind of refusal of an export. */
const EXPORT_FIELDS = {
  noIndividual: {},
  readsAsMissing: { columnName: isText, individual: isText },
  errorAsName: { columnName: isText },
  spacesAtEnds: { columnName: isText, individual: isIndividual },
  integerTooLarge: { columnName: isText, individual: isText },
  cannotCarry: { columnName: isText, individual: isIndividual, character: isCharacter },
  textTooLong: { columnName: isText, individual: isIndividual, length: isCount },
  tooLargeForSheet: { rows: isCount, columns: isCount },
  readsAsVariantsFile: {},
};

/** Why a file was not imported. */
export type ImportRefusal = Tagged<typeof IMPORT_FIELDS>;

/** Why the table was not exported. */
export type ExportRefusal = Tagged<typeof EXPORT_FIELDS>;

/** Whether `value` is a refusal of an import, with exactly the fields of its kind. */
export const isImportRefusal: (value: unknown) => value is ImportRefusal =
  taggedDecoder(IMPORT_FIELDS);

/** Whether `value` is a refusal of an export, with exactly the fields of its kind. */
export const isExportRefusal: (value: unknown) => value is ExportRefusal =
  taggedDecoder(EXPORT_FIELDS);
