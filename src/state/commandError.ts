// A command the backend refused, as the core's CommandError crosses to a
// window: its kind and its fields, in camelCase
// (crates/vavilov-core/src/error.rs). The table below is the one list of
// them on this side, and the type is made from it (tagged.ts).

import { isRole, isStorageType } from "./description.ts";
import { isCellRefusal } from "./cellRefusal.ts";
import { isExportRefusal, isImportRefusal } from "./fileRefusal.ts";
import { isGroupRefusal } from "./groupRefusal.ts";
import {
  isColumnIdField,
  isCount,
  isLevelCodeField,
  isPositionField,
  isRevisionField,
  isRowIndexField,
  isText,
  oneOf,
  taggedDecoder,
} from "./tagged.ts";
import type { Tagged } from "./tagged.ts";

/** What the file system refused, as `IoFailure` in the core. */
export type IoFailure = "notFound" | "permissionDenied" | "other";

const isIoFailure = oneOf<IoFailure>(["notFound", "permissionDenied", "other"]);

/** The fields of each kind of refusal, and the check of each. */
const FIELDS = {
  noProject: {},
  madeBeforeLoad: { basedOn: isRevisionField, loadedAt: isRevisionField },
  levelsChanged: { column: isColumnIdField, basedOn: isRevisionField, levelsAt: isRevisionField },
  unknownWindow: { label: isText },
  unknownColumn: { column: isColumnIdField },
  notCategory: { column: isColumnIdField },
  notNumber: { column: isColumnIdField },
  notRole: { column: isColumnIdField, role: isRole },
  windowFailed: { label: isText, message: isText },
  roleNotPossible: { column: isColumnIdField, storage: isStorageType, role: isRole },
  valueNotFor: { column: isColumnIdField, role: isRole, row: isRowIndexField },
  notActiveClassification: { column: isColumnIdField },
  unknownLevel: { column: isColumnIdField, code: isLevelCodeField, numLevels: isCount },
  noGroupSelected: {},
  notSelected: {},
  rowSetLength: { numRows: isCount, numBytes: isCount },
  rowSetUnusedBits: { numRows: isCount },
  rowOutOfRange: { row: isRowIndexField, numRows: isCount },
  rowsOutOfRange: { first: isPositionField, count: isCount, numShown: isCount },
  nothingToUndo: {},
  nothingToRedo: {},
  tooManyRows: { numRows: isCount, maxRows: isCount },
  tooManyColumns: { numColumns: isCount, maxColumns: isCount },
  notIndividualId: { header: isText },
  emptyIndividual: { row: isRowIndexField },
  duplicateIndividual: { name: isText, firstRow: isRowIndexField, secondRow: isRowIndexField },
  emptyColumnName: { position: isCount },
  duplicateColumnName: { name: isText },
  columnLength: { columnName: isText, numValues: isCount, numRows: isCount },
  nonFiniteNumber: { columnName: isText, row: isRowIndexField },
  emptyText: { columnName: isText, row: isRowIndexField },
  tooManyLevels: { columnName: isText, numLevels: isCount, maxLevels: isCount },
  levelColours: { columnName: isText, numLevels: isCount, numColours: isCount },
  nonFiniteLevel: { columnName: isText, code: isLevelCodeField },
  notACountry: { columnName: isText, level: isText },
  emptyLevelName: { columnName: isText, code: isLevelCodeField },
  duplicateLevel: { columnName: isText, level: isText },
  codeWithoutLevel: {
    columnName: isText,
    row: isRowIndexField,
    code: isLevelCodeField,
    numLevels: isCount,
  },
  importRefused: { fileName: isText, refusal: isImportRefusal },
  importUnreadable: { fileName: isText, message: isText },
  fileNotRead: { fileName: isText, io: isIoFailure, message: isText },
  exportRefused: { refusal: isExportRefusal },
  fileNotWritten: { fileName: isText, io: isIoFailure, message: isText },
  cellRefused: { columnName: isText, text: isText, refusal: isCellRefusal },
  groupRefused: { columnName: isText, text: isText, refusal: isGroupRefusal },
  defect: { what: isText },
};

/** Why the backend refused a command; a refused command changed nothing. */
export type CommandError = Tagged<typeof FIELDS>;

/**
 * A refusal a window receives as a value: every kind but a defect, which is
 * thrown, and a command made before the current table was loaded or before
 * the groups it names changed, which the window does not show
 * (`docs/core.md`, section 4).
 */
export type Refusal = Exclude<
  CommandError,
  { readonly kind: "defect" | "madeBeforeLoad" | "levelsChanged" }
>;

/**
 * Whether `value` is a refusal of the backend: an object with a known kind
 * and exactly the fields of that kind, each of its type.
 */
export const isCommandError: (value: unknown) => value is CommandError = taggedDecoder(FIELDS);
