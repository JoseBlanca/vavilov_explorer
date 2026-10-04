// The import and the export as a window sends and receives them: the items
// of the menu the backend hands to the main window, the choices of an
// export, and the answers of the two commands
// (src-tauri/src/transfer.rs, crates/vavilov-core/src/formats.rs).

import type { Separator } from "./fileRefusal.ts";
import { isText, taggedDecoder } from "./tagged.ts";

/** The items of the menu a window carries out, in the order of their codes, 1 and on. */
export const MENU_ACTIONS = [
  "importTable",
  "exportCsv",
  "exportXlsx",
  "undo",
  "redo",
  "scatter3d",
  "map",
  "countryMap",
  "histogram",
  "selectNone",
] as const;

/**
 * An item of the menu a window carries out: Import table…, Export as CSV…,
 * Export as Excel…, Undo, Redo, 3D scatter…, Map…, Map of countries…,
 * Histogram… and Select None.
 */
export type MenuAction = (typeof MENU_ACTIONS)[number];

/** The mark between the whole part and the decimals of a number. */
export type DecimalMark = "point" | "comma";

/** The encoding of a CSV: UTF-8, UTF-8 with the mark Excel writes, or Windows-1252. */
export type CsvEncoding = "utf8" | "utf8WithMark" | "windows1252";

/** How a missing value is written in a CSV: an empty cell, or `NA`. */
export type MissingText = "empty" | "na";

/** What the user chose for the export of a CSV. */
export interface CsvChoices {
  /** The character between the cells. */
  readonly separator: Separator;
  /** The mark of the decimals. */
  readonly decimal: DecimalMark;
  /** The encoding. */
  readonly encoding: CsvEncoding;
  /** How a missing value is written. */
  readonly missing: MissingText;
}

/** The format of an export. */
export type ExportFormat =
  { readonly kind: "csv"; readonly choices: CsvChoices } | { readonly kind: "xlsx" };

/** What an import gave: nothing when the user closed the dialog, or the table loaded. */
export type ImportAnswer =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "imported";
      /** The name of the file, without its folder. */
      readonly fileName: string;
      /** The line of the first character that could not be decoded, or `null`. */
      readonly undecodedLine: number | null;
    };

/** What an export gave: nothing when the user closed the dialog, or the file written. */
export type ExportAnswer =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "exported";
      /** The name of the file, without its folder. */
      readonly fileName: string;
    };

/** A line of a file, or none. */
function isLine(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value));
}

/** Whether `value` is an answer of `import_table`, with exactly the fields of its kind. */
const isImportAnswer: (value: unknown) => value is ImportAnswer = taggedDecoder({
  cancelled: {},
  imported: { fileName: isText, undecodedLine: isLine },
});

/** Whether `value` is an answer of `export_table`, with exactly the fields of its kind. */
const isExportAnswer: (value: unknown) => value is ExportAnswer = taggedDecoder({
  cancelled: {},
  exported: { fileName: isText },
});

/** The answer of `import_table`, or `null` when `value` is not one. */
export function importAnswerOf(value: unknown): ImportAnswer | null {
  return isImportAnswer(value) ? value : null;
}

/** The answer of `export_table`, or `null` when `value` is not one. */
export function exportAnswerOf(value: unknown): ExportAnswer | null {
  return isExportAnswer(value) ? value : null;
}

/**
 * The choices an export of a CSV starts from, by the decimal mark of the
 * system's region, `mark`, which Excel follows: `;` and a decimal comma
 * where numbers are written with a comma, as a Spanish Excel reads them,
 * and `,` and a point otherwise; UTF-8 with the mark, which Excel reads as UTF-8; and a missing
 * value as an empty cell (decided by the owner on 2 October 2026,
 * docs/design.md, section 7).
 */
export function csvDefaults(mark: string): CsvChoices {
  const comma = mark === ",";
  return {
    separator: comma ? "semicolon" : "comma",
    decimal: comma ? "comma" : "point",
    encoding: "utf8WithMark",
    missing: "empty",
  };
}

/**
 * The decimal marks a CSV split by `separator` may have: only the point
 * when the comma is the separator, since table_io would write each
 * decimal number in quotes, "1,5", which the import reads back as text
 * (decided by the owner on 2 October 2026).
 */
export function decimalMarksWith(separator: Separator): readonly DecimalMark[] {
  return separator === "comma" ? ["point"] : ["comma", "point"];
}

/** `choices`, with the decimal mark moved to the point when its separator does not allow it. */
export function fittedCsvChoices(choices: CsvChoices): CsvChoices {
  return decimalMarksWith(choices.separator).includes(choices.decimal)
    ? choices
    : { ...choices, decimal: "point" };
}
