// The description of the table a window asks for (describe_table): its
// columns, their storage types and roles, and the values and colours of the
// levels, as the core's TableDescription
// (crates/vavilov-core/src/description.rs; docs/design.md, section 6).

import { isColumnId, isRevision } from "./ids.ts";
import type { ColumnId, Revision } from "./ids.ts";

/** Every storage type, as `StorageType` in the core. */
export const STORAGE_TYPES = ["integer", "float", "boolean", "text"] as const;

/** What a column's values are, as the import read them. */
export type StorageType = (typeof STORAGE_TYPES)[number];

/** Every role, in the order the dropdown of a column lists them, as `Role::ALL` in the core. */
export const ROLES = ["number", "latitude", "longitude", "category", "country", "text"] as const;

/**
 * What a column is for, which the user chooses. Latitude and longitude are
 * sub-roles of number, and country of category (docs/design.md, section 6).
 * Any category can be the active classification.
 */
export type Role = (typeof ROLES)[number];

/** The roles whose codes the window's copy holds, as `Role::is_categorical` in the core. */
export type CategoricalRole = Extract<Role, "category" | "country">;

/** The roles whose values a page of rows carries. */
export type ValuesRole = Exclude<Role, CategoricalRole>;

/** Whether `role` holds codes into levels: a category, of countries or not. */
export function isCategorical(role: Role): role is CategoricalRole {
  switch (role) {
    case "category":
    case "country":
      return true;
    case "number":
    case "latitude":
    case "longitude":
    case "text":
      return false;
  }
}

/** Whether `value` is a storage type. */
export function isStorageType(value: unknown): value is StorageType {
  return STORAGE_TYPES.some((storage) => storage === value);
}

/**
 * The value of a level: a whole number as text, since JSON cannot hold every
 * 64-bit integer; a decimal number as a number; yes or no as a boolean;
 * text as text. The column's storage type says which.
 */
export type LevelValue = string | number | boolean;

/** A level of a category: in the active classification, a population. */
export interface LevelDescription {
  /** Its value, of the column's storage type. */
  readonly value: LevelValue;
  /** Its colour, as CSS writes it, `#rrggbb`. */
  readonly colour: string;
}

/** What every column other than the first has. */
interface ColumnCommon {
  /** Its id. */
  readonly id: ColumnId;
  /** Its name, as in the user's file. */
  readonly name: string;
  /** The revision at which it last changed. */
  readonly revision: Revision;
  /** What its values are. */
  readonly storage: StorageType;
  /** The roles it can take, its own among them, in the order of `ROLES`. */
  readonly roles: readonly Role[];
}

/**
 * A number, of its sub-roles, or a text, whose values a page of rows
 * carries. Each role is a member of its own, `role` a single value, so that
 * TypeScript narrows on it in both branches of a test.
 */
export interface ValuesColumn<R extends ValuesRole> extends ColumnCommon {
  /** What it is for. */
  readonly role: R;
}

/** A category, of countries or not, whose codes the window's copy holds. */
export interface CategoricalColumn<R extends CategoricalRole> extends ColumnCommon {
  /** What it is for. */
  readonly role: R;
  /** Its levels, in the order of their codes. */
  readonly levels: readonly LevelDescription[];
}

/** A column other than the first. */
export type ColumnDescription =
  | ValuesColumn<"number">
  | ValuesColumn<"latitude">
  | ValuesColumn<"longitude">
  | ValuesColumn<"text">
  | CategoricalColumn<"category">
  | CategoricalColumn<"country">;

/**
 * The description a window's components draw from: none with no project;
 * behind while the window's copy is at a newer load or shape than the
 * description it has, as between a change of role and the description asked
 * for after it, when a component keeps what it drew; or current.
 */
export type DescriptionNow =
  | { readonly kind: "none" }
  | { readonly kind: "behind" }
  | { readonly kind: "current"; readonly description: TableDescription };

/** Whether `column` holds codes into levels: a category, of countries or not. */
export function isCategoricalColumn(
  column: ColumnDescription,
): column is CategoricalColumn<CategoricalRole> {
  return isCategorical(column.role);
}

/** The table of the open project. */
export interface TableDescription {
  /** The revision at which the table was loaded. */
  readonly loadedAt: Revision;
  /** The revision at which the columns, their names or their roles last changed. */
  readonly shapeAt: Revision;
  /** The number of rows, one per individual. */
  readonly numRows: number;
  /** The first column, which names the individuals, and its header, IndividualID. */
  readonly names: { readonly id: ColumnId; readonly header: string };
  /** The other columns, in their order. */
  readonly columns: readonly ColumnDescription[];
}

const COLOUR = /^#[0-9a-f]{6}$/;
/** A whole number written as the core writes an `i64`. */
const INTEGER = /^-?(0|[1-9][0-9]*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is a level's value of the storage type `storage`. */
function isLevelValue(value: unknown, storage: StorageType): boolean {
  switch (storage) {
    case "integer":
      return typeof value === "string" && INTEGER.test(value);
    case "float":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "text":
      return typeof value === "string" && value !== "";
  }
}

/** Whether `value` is a role. */
export function isRole(value: unknown): value is Role {
  return ROLES.some((role) => role === value);
}

/** The storage types each role can have, as the core allows them. */
function fitsStorage(role: Role, storage: StorageType): boolean {
  switch (role) {
    case "number":
    case "latitude":
    case "longitude":
      return storage === "integer" || storage === "float";
    case "country":
    case "text":
      return storage === "text";
    case "category":
      return true;
  }
}

function isColumn(value: unknown): value is ColumnDescription {
  if (!isRecord(value)) {
    return false;
  }
  const { id, name, revision, storage, role, roles } = value;
  const common =
    typeof id === "number" &&
    isColumnId(id) &&
    typeof name === "string" &&
    typeof revision === "number" &&
    isRevision(revision) &&
    isStorageType(storage) &&
    isRole(role) &&
    fitsStorage(role, storage) &&
    Array.isArray(roles) &&
    roles.every(isRole) &&
    roles.includes(role);
  if (!common) {
    return false;
  }
  const { levels } = value;
  if (!isCategorical(role)) {
    return levels === undefined;
  }
  return (
    Array.isArray(levels) &&
    levels.every(
      (level) =>
        isRecord(level) &&
        isLevelValue(level["value"], storage) &&
        typeof level["colour"] === "string" &&
        COLOUR.test(level["colour"]),
    )
  );
}

/** Whether `value` is the description the backend sends, every id of its type. */
export function isTableDescription(value: unknown): value is TableDescription {
  if (!isRecord(value)) {
    return false;
  }
  const { loadedAt, shapeAt, numRows, names, columns } = value;
  return (
    typeof loadedAt === "number" &&
    isRevision(loadedAt) &&
    typeof shapeAt === "number" &&
    isRevision(shapeAt) &&
    typeof numRows === "number" &&
    Number.isSafeInteger(numRows) &&
    numRows >= 0 &&
    isRecord(names) &&
    typeof names["id"] === "number" &&
    isColumnId(names["id"]) &&
    typeof names["header"] === "string" &&
    Array.isArray(columns) &&
    columns.every(isColumn)
  );
}
