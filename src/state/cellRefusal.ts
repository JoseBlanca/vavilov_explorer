// Why a value typed in a cell of the table was refused, as the core's
// CellRefusal crosses to a window inside a refusal (crates/vavilov-core/
// src/error/cell.rs): a kind and its fields, in camelCase. The table below
// is the one list of them on this side, and the type is made from it.

import { hasFieldsOf } from "./tagged.ts";

/** The fields of each kind of refusal of a value typed in a cell. */
const CELL_FIELDS = {
  notWholeNumber: {},
  notDecimalNumber: { decimalMark: "string" },
  notLatitude: {},
  notLongitude: {},
  notYesOrNo: {},
  notACountry: {},
  notALevel: {},
  emptyId: {},
  idTaken: {},
} as const satisfies Record<string, Record<string, "string">>;

type CellFields = typeof CELL_FIELDS;

/** Why a value typed in a cell does not fit its column; every cell kept its value. */
export type CellRefusal = {
  [K in keyof CellFields]: { readonly kind: K } & {
    readonly [F in keyof CellFields[K]]: string;
  };
}[keyof CellFields];

const CELL_OF_KIND: ReadonlyMap<string, Readonly<Record<string, "string">>> = new Map(
  Object.entries(CELL_FIELDS),
);

/** Whether `value` is a refusal of a value typed in a cell, with exactly the fields of its kind. */
export function isCellRefusal(value: unknown): value is CellRefusal {
  return hasFieldsOf(value, CELL_OF_KIND, (field) => typeof field === "string");
}
