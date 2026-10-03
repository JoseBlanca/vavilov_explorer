// The check of a value the backend serialised as an object with a `kind`,
// the name of a case of a Rust enum, and the fields of that case
// (crates/vavilov-core/src/error.rs), shared by the refusals of a command,
// of a file, of a cell and of a group's name. Each is described by a
// table of its kinds, each kind with the check of each of its fields; the
// decoder and the TypeScript type are both made from that table, so that
// the table is the one list of the kinds on this side.

import { isColumnId, isLevelCode, isPosition, isRevision, isRowIndex } from "./ids.ts";
import type { ColumnId, LevelCode, Position, Revision, RowIndex } from "./ids.ts";

/** The check of a field, which tells its TypeScript type. */
export type FieldCheck<T> = (value: unknown) => value is T;

/** The fields of each kind, by name, each with its check. */
export type KindTable = Readonly<Record<string, Readonly<Record<string, FieldCheck<unknown>>>>>;

/** The union of the kinds of `Table`, each with the type of each of its fields. */
export type Tagged<Table extends KindTable> = {
  [K in keyof Table]: { readonly kind: K } & {
    readonly [F in keyof Table[K]]: Table[K][F] extends FieldCheck<infer T> ? T : never;
  };
}[keyof Table];

/**
 * The decoder of the kinds of `table`: whether a value is an object with a
 * `kind` the table has, and exactly the fields of that kind, each passing
 * its check.
 */
export function taggedDecoder<Table extends KindTable>(
  table: Table,
): (value: unknown) => value is Tagged<Table> {
  const fieldsOfKind: ReadonlyMap<string, Readonly<Record<string, FieldCheck<unknown>>>> = new Map(
    Object.entries(table),
  );
  return (value: unknown): value is Tagged<Table> => {
    if (typeof value !== "object" || value === null || !("kind" in value)) {
      return false;
    }
    const { kind } = value;
    if (typeof kind !== "string") {
      return false;
    }
    const fields = fieldsOfKind.get(kind);
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
      const check = Object.hasOwn(fields, name) ? fields[name] : undefined;
      return check?.(field) === true;
    });
  };
}

/** A text. */
export function isText(value: unknown): value is string {
  return typeof value === "string";
}

/** A count, or another whole number that is never negative and fits a double exactly. */
export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** The id of a column. */
export function isColumnIdField(value: unknown): value is ColumnId {
  return typeof value === "number" && isColumnId(value);
}

/** The code of a level. */
export function isLevelCodeField(value: unknown): value is LevelCode {
  return typeof value === "number" && isLevelCode(value);
}

/** The index of a row. */
export function isRowIndexField(value: unknown): value is RowIndex {
  return typeof value === "number" && isRowIndex(value);
}

/** A position among the rows shown. */
export function isPositionField(value: unknown): value is Position {
  return typeof value === "number" && isPosition(value);
}

/** A revision. */
export function isRevisionField(value: unknown): value is Revision {
  return typeof value === "number" && isRevision(value);
}

/** The check of a field that is one of `values`. */
export function oneOf<const T extends string>(values: readonly T[]): FieldCheck<T> {
  return (value: unknown): value is T => values.some((allowed) => allowed === value);
}
