// The description of the table a window asks for (describe_table): its
// columns, their types, and the names and colours of the levels, as the
// core's TableDescription (crates/vavilov-core/src/description.rs).

import { isColumnId, isRevision } from "./ids.ts";
import type { ColumnId, Revision } from "./ids.ts";

/** A level of a categorical column: in a classification, a population. */
export interface LevelDescription {
  /** Its name, as in the user's file. */
  readonly name: string;
  /** Its colour, as CSS writes it, `#rrggbb`. */
  readonly colour: string;
}

/** A column other than the first. */
export type ColumnDescription = {
  /** Its id. */
  readonly id: ColumnId;
  /** Its name, as in the user's file. */
  readonly name: string;
  /** The revision at which it last changed. */
  readonly revision: Revision;
} & (
  | { readonly type: "numeric" | "integer" | "text" | "boolean" }
  | { readonly type: "categorical"; readonly levels: readonly LevelDescription[] }
);

/** The table of the open project. */
export interface TableDescription {
  /** The revision at which the table was loaded. */
  readonly loadedAt: Revision;
  /** The number of rows, one per individual. */
  readonly numRows: number;
  /** The first column, which names the individuals. */
  readonly names: { readonly id: ColumnId; readonly header: string };
  /** The other columns, in their order. */
  readonly columns: readonly ColumnDescription[];
}

const COLOUR = /^#[0-9a-f]{6}$/;
const PLAIN_TYPES: readonly unknown[] = ["numeric", "integer", "text", "boolean"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is LevelDescription {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["colour"] === "string" &&
    COLOUR.test(value["colour"])
  );
}

function isColumn(value: unknown): value is ColumnDescription {
  if (!isRecord(value)) {
    return false;
  }
  const { id, name, revision, type } = value;
  const common =
    typeof id === "number" &&
    isColumnId(id) &&
    typeof name === "string" &&
    typeof revision === "number" &&
    isRevision(revision);
  if (!common) {
    return false;
  }
  if (type === "categorical") {
    const { levels } = value;
    return Array.isArray(levels) && levels.every(isLevel);
  }
  return PLAIN_TYPES.includes(type);
}

/** Whether `value` is the description the backend sends, every id of its type. */
export function isTableDescription(value: unknown): value is TableDescription {
  if (!isRecord(value)) {
    return false;
  }
  const { loadedAt, numRows, names, columns } = value;
  return (
    typeof loadedAt === "number" &&
    isRevision(loadedAt) &&
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
