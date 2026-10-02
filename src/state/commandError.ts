// A command the backend refused, as the core's CommandError crosses to a
// window: its kind and its fields, in camelCase
// (crates/vavilov-core/src/error.rs). The table below is the one list of
// them on this side, and the type is made from it.

import { isColumnId, isLevelCode, isRevision, isRowIndex } from "./ids.ts";
import type { ColumnId, LevelCode, Revision, RowIndex } from "./ids.ts";
import type { Selected } from "./message.ts";
import { isRole, isStorageType } from "./description.ts";
import type { Role, StorageType } from "./description.ts";

/** The type of a field: an id, a count, or a text from the user's file. */
type FieldType =
  | "columnId"
  | "levelCode"
  | "rowIndex"
  | "revision"
  | "selected"
  | "storage"
  | "role"
  | "number"
  | "string";

/** The fields of each kind of refusal, and the type of each. */
const FIELDS = {
  noProject: {},
  madeBeforeLoad: { basedOn: "revision", loadedAt: "revision" },
  unknownWindow: { label: "string" },
  unknownColumn: { column: "columnId" },
  notCategory: { column: "columnId" },
  roleNotPossible: { column: "columnId", storage: "storage", role: "role" },
  valueNotFor: { column: "columnId", role: "role", row: "rowIndex" },
  notActiveClassification: { column: "columnId" },
  unknownLevel: { column: "columnId", code: "levelCode", numLevels: "number" },
  noPopulationSelected: {},
  notSelected: { target: "selected" },
  rowSetLength: { numRows: "number", numBytes: "number" },
  rowSetUnusedBits: { numRows: "number" },
  rowOutOfRange: { row: "rowIndex", numRows: "number" },
  rowsOutOfRange: { first: "number", count: "number", numRows: "number" },
  nothingToUndo: {},
  nothingToRedo: {},
  tooManyRows: { numRows: "number", maxRows: "number" },
  tooManyColumns: { numColumns: "number", maxColumns: "number" },
  notIndividualId: { header: "string" },
  emptyIndividual: { row: "rowIndex" },
  duplicateIndividual: { name: "string", firstRow: "rowIndex", secondRow: "rowIndex" },
  emptyColumnName: { position: "number" },
  duplicateColumnName: { name: "string" },
  columnLength: { columnName: "string", numValues: "number", numRows: "number" },
  nonFiniteNumber: { columnName: "string", row: "rowIndex" },
  emptyText: { columnName: "string", row: "rowIndex" },
  tooManyLevels: { columnName: "string", numLevels: "number", maxLevels: "number" },
  levelColours: { columnName: "string", numLevels: "number", numColours: "number" },
  nonFiniteLevel: { columnName: "string", code: "levelCode" },
  notACountry: { columnName: "string", level: "string" },
  emptyLevelName: { columnName: "string", code: "levelCode" },
  duplicateLevel: { columnName: "string", level: "string" },
  codeWithoutLevel: {
    columnName: "string",
    row: "rowIndex",
    code: "levelCode",
    numLevels: "number",
  },
  defect: { what: "string" },
} as const satisfies Record<string, Record<string, FieldType>>;

type Fields = typeof FIELDS;

/** A selection as the backend serialises one, `{ "population": code }` or `"unassigned"`. */
export type SelectedOnWire = { readonly population: LevelCode } | "unassigned";

/** The TypeScript type of each type of field. */
interface TypeOf {
  readonly columnId: ColumnId;
  readonly levelCode: LevelCode;
  readonly rowIndex: RowIndex;
  readonly revision: Revision;
  readonly selected: SelectedOnWire;
  readonly storage: StorageType;
  readonly role: Role;
  readonly number: number;
  readonly string: string;
}

/** Why the backend refused a command; a refused command changed nothing. */
export type CommandError = {
  [K in keyof Fields]: { readonly kind: K } & {
    readonly [F in keyof Fields[K]]: Fields[K][F] extends FieldType ? TypeOf[Fields[K][F]] : never;
  };
}[keyof Fields];

/**
 * A refusal a window receives as a value: every kind but a defect, which is
 * thrown, and a command made before the current table was loaded, which the
 * window does not show (`docs/core.md`, section 4).
 */
export type Refusal = Exclude<CommandError, { readonly kind: "defect" | "madeBeforeLoad" }>;

const FIELDS_OF_KIND: ReadonlyMap<string, Readonly<Record<string, FieldType>>> = new Map(
  Object.entries(FIELDS),
);

/** Whether `value` is a field of `type`. */
function hasType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    case "columnId":
      return typeof value === "number" && isColumnId(value);
    case "levelCode":
      return typeof value === "number" && isLevelCode(value);
    case "rowIndex":
      return typeof value === "number" && isRowIndex(value);
    case "revision":
      return typeof value === "number" && isRevision(value);
    case "selected":
      return selectedOf(value) !== null;
    case "storage":
      return isStorageType(value);
    case "role":
      return isRole(value);
  }
}

/**
 * The selection a window works with, from one as the backend serialises
 * it, or `null` when `value` is not one.
 */
export function selectedOf(value: unknown): Selected | null {
  if (value === "unassigned") {
    return { kind: "unassigned" };
  }
  if (typeof value === "object" && value !== null && "population" in value) {
    const entries = Object.keys(value);
    const { population } = value;
    if (entries.length === 1 && typeof population === "number" && isLevelCode(population)) {
      return { kind: "population", code: population };
    }
  }
  return null;
}

/**
 * Whether `value` is a refusal of the backend: an object with a known kind
 * and exactly the fields of that kind, each of its type.
 */
export function isCommandError(value: unknown): value is CommandError {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const { kind } = value;
  if (typeof kind !== "string") {
    return false;
  }
  const fields = FIELDS_OF_KIND.get(kind);
  if (fields === undefined) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== Object.keys(fields).length + 1) {
    return false;
  }
  return entries.every(([name, field]) => {
    if (name === "kind") {
      return true;
    }
    const type = Object.hasOwn(fields, name) ? fields[name] : undefined;
    return type !== undefined && hasType(field, type);
  });
}
