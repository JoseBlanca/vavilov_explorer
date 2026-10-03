// Why a value typed in a cell of the table was refused, as the core's
// CellRefusal crosses to a window inside a refusal (crates/vavilov-core/
// src/error/cell.rs): a kind and its fields, in camelCase. The table below
// is the one list of them on this side, and the type is made from it.

import { isText, taggedDecoder } from "./tagged.ts";
import type { Tagged } from "./tagged.ts";

/** The fields of each kind of refusal of a value typed in a cell. */
const CELL_FIELDS = {
  notWholeNumber: {},
  notDecimalNumber: { decimalMark: isText },
  notLatitude: {},
  notLongitude: {},
  notYesOrNo: {},
  notACountry: {},
  notALevel: {},
  emptyId: {},
  idTaken: {},
};

/** Why a value typed in a cell does not fit its column; every cell kept its value. */
export type CellRefusal = Tagged<typeof CELL_FIELDS>;

/** Whether `value` is a refusal of a value typed in a cell, with exactly the fields of its kind. */
export const isCellRefusal: (value: unknown) => value is CellRefusal = taggedDecoder(CELL_FIELDS);
