// The words the user reads when an import or an export is refused, or
// when an import read a character it could not decode, written from the
// kind and the data of the backend's refusal, in the names of the user's
// file (.claude/skills/writing/SKILL.md, "The text of the app";
// docs/design.md, sections 2.1 and 7).

import type { BarMessage } from "./barMessages.ts";
import type { IoFailure, Refusal } from "./commandError.ts";
import type { ExportRefusal, FileFormat, ImportRefusal, Separator } from "./fileRefusal.ts";

/** What a refusal says: what happened, in one line, and how to put it right. */
export interface Explanation {
  /** What happened, in one line. */
  readonly heading: string;
  /** What was found, and how to put it right. */
  readonly text: string;
}

/** Writes a count or a position for the user, `1,203` in English. */
export type Count = (value: number) => string;

/** The individuals a sheet of Excel holds below its header, as table_io's limit of rows. */
const EXCEL_INDIVIDUALS = 1_048_575;

/** The columns a sheet of Excel holds. */
const EXCEL_COLUMNS = 16_384;

/** The characters a cell of Excel holds, counted in UTF-16 units. */
const EXCEL_CELL_CHARACTERS = 32_767;

/** The bound, on each side of zero, below which a number of Excel holds every whole number. */
const EXCEL_EXACT_INTEGER = 2 ** 53;

/** The kinds of refusal that are about a file the user chose. */
const FILE_KINDS = [
  "importRefused",
  "importUnreadable",
  "fileNotRead",
  "exportRefused",
  "fileNotWritten",
] as const;

/** A refusal of an import or an export, about a file the user chose. */
export type FileRefusal = Extract<Refusal, { readonly kind: (typeof FILE_KINDS)[number] }>;

/** Whether `error` is about a file the user chose. */
export function isFileRefusal(error: Refusal): error is FileRefusal {
  return FILE_KINDS.some((kind) => kind === error.kind);
}

/**
 * The error the information bar shows for a refusal of an import or an
 * export: what happened, then how to put it right.
 */
export function fileRefusalMessage(error: FileRefusal, count: Count): BarMessage {
  const { heading, text } = fileRefusalText(error, count);
  return { kind: "error", text: `${heading}. ${text}` };
}

/**
 * The error the information bar shows for a refusal of File > Open
 * Example Table: the file installed with the app not found, which the user
 * never chose and cannot choose again, or the words of any file's refusal.
 */
export function exampleRefusalMessage(error: FileRefusal, count: Count): BarMessage {
  if (error.kind === "fileNotRead" && error.io === "notFound") {
    return {
      kind: "error",
      text: "The example table installed with Vavilov Explorer is missing. Reinstalling the app puts it back.",
    };
  }
  return fileRefusalMessage(error, count);
}

/**
 * The warning the information bar shows for an import that read a
 * character it could not decode.
 */
export function undecodedMessage(fileName: string, line: number, count: Count): BarMessage {
  return { kind: "warning", text: undecodedText(fileName, line, count) };
}

/** The words of a refusal of an import or an export. */
export function fileRefusalText(error: FileRefusal, count: Count): Explanation {
  switch (error.kind) {
    case "importRefused":
      return {
        heading: `“${error.fileName}” was not imported`,
        text: importText(error.refusal, count),
      };
    case "importUnreadable":
      return {
        heading: `“${error.fileName}” was not imported`,
        text: `It could not be read as an Excel workbook, and may be damaged. Open it in Excel and save it again, or save it as CSV, and import that.`,
      };
    case "fileNotRead":
      return {
        heading: `“${error.fileName}” was not imported`,
        text: notReadText(error.io, error.message),
      };
    case "exportRefused":
      return { heading: "The table was not exported", text: exportText(error.refusal, count) };
    case "fileNotWritten":
      return {
        heading: `“${error.fileName}” was not written`,
        text: notWrittenText(error.io, error.message),
      };
  }
}

/** Why a file could not be read, from what the file system refused. */
function notReadText(io: IoFailure, message: string): string {
  switch (io) {
    case "notFound":
      return "The file is no longer where it was chosen: it was moved or deleted. Choose it again.";
    case "permissionDenied":
      return "Vavilov Explorer is not allowed to read it. Copy it to a folder of your own, such as Documents, and import the copy.";
    case "other":
      return `It could not be read from the disk: ${message}.`;
  }
}

/**
 * Why a file could not be written, from what the file system refused.
 * Windows refuses a file another program holds open, such as Excel, as a
 * permission denied.
 */
function notWrittenText(io: IoFailure, message: string): string {
  switch (io) {
    case "notFound":
      return "Its folder is no longer there. Export again, and choose another folder.";
    case "permissionDenied":
      return "Vavilov Explorer is not allowed to write there. Export again and choose a folder of your own, such as Documents, or, if the file is open in another program such as Excel, close it there and export again.";
    case "other":
      return `It could not be written to the disk: ${message}. A file that was there before is left as it was.`;
  }
}

/** `value` and the noun it counts, `one` for 1 and `many` for any other. */
function counted(value: number, one: string, many: string, count: Count): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** The words of the warning of an import that read a character it could not decode. */
export function undecodedText(fileName: string, line: number, count: Count): string {
  return `“${fileName}” was imported, but line ${count(line)} has a character that could not be read, shown as �. Save the file as UTF-8 and import it again if the text matters.`;
}

/** The separator as a sentence names it. */
function separatorText(separator: Separator): string {
  switch (separator) {
    case "tab":
      return "the tab";
    case "semicolon":
      return "“;”";
    case "comma":
      return "“,”";
  }
}

/** A column as the user finds it: a place in a line, or Excel's letters. */
function columnText(format: FileFormat, column: number, count: Count): string {
  return format === "text" ? `column ${count(column)}` : `column ${excelColumn(column)}`;
}

/** A row as the user finds it: a line of a text file, or a row of the sheet. */
function rowText(format: FileFormat, row: number, count: Count): string {
  return format === "text" ? `line ${count(row)}` : `row ${count(row)} of the sheet`;
}

/** Excel's letters of column `column`, A being 1: 27 is AA. */
export function excelColumn(column: number): string {
  let letters = "";
  for (let left = column; left > 0; left = Math.floor((left - 1) / 26)) {
    letters = String.fromCharCode(65 + ((left - 1) % 26)) + letters;
  }
  return letters;
}

function importText(refusal: ImportRefusal, count: Count): string {
  switch (refusal.kind) {
    case "tooLarge":
      return `It is ${count(Math.ceil(refusal.size / 1_000_000))} MB, and Vavilov Explorer imports files of up to ${count(Math.floor(refusal.maxBytes / 1_000_000))} MB. If it is the table you meant, remove the columns you do not need and import it again.`;
    case "oldExcel":
      return "It is a workbook of Excel 97–2003. Open it in Excel, save it as an Excel Workbook (.xlsx) or as CSV, and import that.";
    case "encrypted":
      return "It is protected with a password. Open it in Excel, save a copy without the password, and import the copy.";
    case "notWorkbook":
      return "It is a zip file, not an Excel workbook. Choose the .xlsx or the .csv file of your table.";
    case "emptySheet":
      return `Its first sheet, “${refusal.sheet}”, is empty. Move your table to the first sheet, or save it as CSV, and import it again.`;
    case "cellError":
      return `A cell holds the error ${refusal.error}, which Excel shows when the data of a formula did not arrive. Open it in Excel, let it calculate, save it and import it again.`;
    case "sheetTooLarge":
      return `Its first sheet, “${refusal.sheet}”, has values in more than ${count(refusal.maxCells)} cells, counted from ${excelColumn(refusal.firstColumn)}${String(refusal.firstRow)} to the last value. Delete the values far from your table, or save the sheet as CSV, and import it again.`;
    case "cutShort":
      return "It ends in the middle of a character, so it may have been cut short when it was copied. Save it again and import it.";
    case "notText":
      return "It is neither a table of text nor an Excel workbook. Choose the .csv, .tsv or .xlsx file of your table.";
    case "variantsFile":
      return "It is a file of variants, a VCF, not a table of individuals. Choose the table with one row per individual.";
    case "unclosedQuote":
      return `The quote that opens a cell on line ${count(refusal.line)} is never closed, reading the file with ${separatorText(refusal.separator)} as the separator. Close the quote and import it again.`;
    case "headerError":
      return `Cell ${excelColumn(refusal.column)}${String(refusal.row)} of the header holds the error ${refusal.error} where the name of a column should be. Write the column's name there and import it again.`;
    case "empty":
      return "It has no header, or no row below its header. Add the individuals, one per row, and import it again.";
    case "unnamedColumn":
      return `${capital(columnText(refusal.format, refusal.column, count))} has values but no name in the header. Name it and import the file again.`;
    case "raggedRow":
      return `Line ${count(refusal.line)}, counting the header as line 1, has ${counted(refusal.found, "cell", "cells", count)} where the header has ${count(refusal.expected)}, reading the file with ${separatorText(refusal.separator)} as the separator. Most often a cell holds ${separatorText(refusal.separator)} and is not in quotes, or a cell is missing. Correct that line and import the file again.`;
    case "duplicateColumn":
      return `Two columns are named “${refusal.name}”, ${columnText(refusal.format, refusal.firstColumn, count)} and ${columnText(refusal.format, refusal.secondColumn, count)}. Give each column a name of its own and import the file again.`;
    case "emptyIndividual":
      return `${capital(rowText(refusal.format, refusal.row, count))} has no IndividualID in its first cell. Write the ID of that individual, or delete the row, and import the file again.`;
    case "duplicateIndividual":
      return `The IndividualID “${refusal.name}” is in two rows, ${rowText(refusal.format, refusal.firstRow, count)} and ${rowText(refusal.format, refusal.secondRow, count)}. Give each individual an ID of its own and import the file again.`;
    case "individualWrittenTwoWays":
      return `Two individuals have the IndividualID “${refusal.name}”, written with different characters that show the same, such as an accent written as part of its letter or after it. Give each individual an ID of its own and import the file again.`;
    case "columnWrittenTwoWays":
      return `Two columns are named “${refusal.name}”, written with different characters that show the same, such as an accent written as part of its letter or after it. Give each column a name of its own and import the file again.`;
    case "notIndividualId":
      return `Its first column, which must hold the ID of each individual, is named “${refusal.header}”. Name it IndividualID and import the file again.`;
    case "namedIndividualId":
      return `${capital(columnText(refusal.format, refusal.column, count))} is named IndividualID, the name only the first column, which holds the ID of each individual, may have. Give it another name and import the file again.`;
  }
}

/** A cell of the table as the user finds it: a column's name, or a value. */
function cellText(columnName: string, individual: string | null): string {
  return individual === null
    ? `The name of the column “${columnName}”`
    : `The value of ${individual} in “${columnName}”`;
}

function exportText(refusal: ExportRefusal, count: Count): string {
  switch (refusal.kind) {
    case "noIndividual":
      return "The table has no individual, and a file of its header alone would not import again.";
    case "readsAsMissing":
      return `The value of ${refusal.individual} in “${refusal.columnName}” is a text that would be read back as a missing value: NA, -, or in an Excel workbook an error such as #N/A. Change it in the file you imported and import that file again.`;
    case "errorAsName":
      return `The column “${refusal.columnName}” is named as an error of Excel, which Excel would read as an error. Export as CSV instead.`;
    case "spacesAtEnds":
      return `${cellText(refusal.columnName, refusal.individual)} has spaces at its start or its end, which an Excel workbook does not keep. Export as CSV, which keeps them, or remove the spaces in the file you imported and import it again.`;
    case "integerTooLarge":
      return `The value of ${refusal.individual} in “${refusal.columnName}” is a whole number beyond ±${count(EXCEL_EXACT_INTEGER)}, which a number of Excel does not hold exactly. Export as CSV instead.`;
    case "cannotCarry":
      return `${cellText(refusal.columnName, refusal.individual)} has the character “${refusal.character}”, which the file cannot hold. Export as CSV with the encoding UTF-8 or UTF-8 for Excel.`;
    case "textTooLong":
      return `${cellText(refusal.columnName, refusal.individual)} has ${count(refusal.length)} characters, counting some, such as emoji, as two, more than the ${count(EXCEL_CELL_CHARACTERS)} a cell of Excel holds. Export as CSV instead.`;
    case "tooLargeForSheet":
      return `The table has ${counted(refusal.rows, "individual", "individuals", count)} and ${counted(refusal.columns, "column", "columns", count)}, more than a sheet of Excel holds below its header, ${count(EXCEL_INDIVIDUALS)} individuals and ${count(EXCEL_COLUMNS)} columns. Export as CSV instead.`;
    case "readsAsVariantsFile":
      return "The name of a column starts with #, which would make the CSV read as a file of variants, a VCF, and not as a table. Rename that column in the file you imported, or export as Excel.";
  }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
