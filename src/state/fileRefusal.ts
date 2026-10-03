// Why a file was not imported or exported, as the core's ImportRefusal and
// ExportRefusal cross to a window inside a refusal (crates/vavilov-core/
// src/error/file.rs): a kind and its fields, in camelCase. The tables below
// are the one list of them on this side, and the types are made from them.

import { hasFieldsOf } from "./tagged.ts";

/** The type of a field. */
type FieldType = "string" | "number" | "format" | "separator" | "individual" | "character";

/** The fields of each kind of refusal of an import. */
const IMPORT_FIELDS = {
  tooLarge: { size: "number", maxBytes: "number" },
  oldExcel: {},
  encrypted: {},
  notWorkbook: {},
  emptySheet: { sheet: "string" },
  cellError: { error: "string" },
  sheetTooLarge: {
    sheet: "string",
    firstRow: "number",
    firstColumn: "number",
    numRows: "number",
    numColumns: "number",
    maxCells: "number",
  },
  cutShort: {},
  notText: {},
  variantsFile: {},
  unclosedQuote: { line: "number", separator: "separator" },
  headerError: { row: "number", column: "number", error: "string" },
  empty: {},
  unnamedColumn: { format: "format", column: "number" },
  raggedRow: { line: "number", expected: "number", found: "number", separator: "separator" },
  duplicateColumn: {
    format: "format",
    name: "string",
    firstColumn: "number",
    secondColumn: "number",
  },
  emptyIndividual: { format: "format", row: "number" },
  duplicateIndividual: {
    format: "format",
    name: "string",
    firstRow: "number",
    secondRow: "number",
  },
  individualWrittenTwoWays: { name: "string" },
  columnWrittenTwoWays: { name: "string" },
  notIndividualId: { header: "string" },
  namedIndividualId: { format: "format", column: "number" },
} as const satisfies Record<string, Record<string, FieldType>>;

/** The fields of each kind of refusal of an export. */
const EXPORT_FIELDS = {
  noIndividual: {},
  readsAsMissing: { columnName: "string", individual: "string" },
  errorAsName: { columnName: "string" },
  spacesAtEnds: { columnName: "string", individual: "individual" },
  integerTooLarge: { columnName: "string", individual: "string" },
  cannotCarry: { columnName: "string", individual: "individual", character: "character" },
  textTooLong: { columnName: "string", individual: "individual", length: "number" },
  tooLargeForSheet: { rows: "number", columns: "number" },
  readsAsVariantsFile: {},
} as const satisfies Record<string, Record<string, FieldType>>;

/** The format a file was read as: its places are lines, or rows and columns of a sheet. */
export type FileFormat = "text" | "xlsx";

/** The character between the cells of a text file. */
export type Separator = "tab" | "semicolon" | "comma";

/** The TypeScript type of each type of field. */
interface TypeOf {
  readonly string: string;
  readonly number: number;
  readonly format: FileFormat;
  readonly separator: Separator;
  /** The individual of a cell, `null` for the header. */
  readonly individual: string | null;
  /** One character, as Rust serialises a `char`. */
  readonly character: string;
}

type Typed<Table> = {
  [K in keyof Table]: { readonly kind: K } & {
    readonly [F in keyof Table[K]]: Table[K][F] extends FieldType ? TypeOf[Table[K][F]] : never;
  };
}[keyof Table];

/** Why a file was not imported. */
export type ImportRefusal = Typed<typeof IMPORT_FIELDS>;

/** Why the table was not exported. */
export type ExportRefusal = Typed<typeof EXPORT_FIELDS>;

const IMPORT_OF_KIND: ReadonlyMap<string, Readonly<Record<string, FieldType>>> = new Map(
  Object.entries(IMPORT_FIELDS),
);
const EXPORT_OF_KIND: ReadonlyMap<string, Readonly<Record<string, FieldType>>> = new Map(
  Object.entries(EXPORT_FIELDS),
);

function hasType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    case "format":
      return value === "text" || value === "xlsx";
    case "separator":
      return value === "tab" || value === "semicolon" || value === "comma";
    case "individual":
      return value === null || typeof value === "string";
    case "character":
      // One code point, as a Rust `char` is.
      return typeof value === "string" && /^[\s\S]$/u.test(value);
  }
}

/** Whether `value` is a refusal of an import, with exactly the fields of its kind. */
export function isImportRefusal(value: unknown): value is ImportRefusal {
  return hasFieldsOf(value, IMPORT_OF_KIND, hasType);
}

/** Whether `value` is a refusal of an export, with exactly the fields of its kind. */
export function isExportRefusal(value: unknown): value is ExportRefusal {
  return hasFieldsOf(value, EXPORT_OF_KIND, hasType);
}
