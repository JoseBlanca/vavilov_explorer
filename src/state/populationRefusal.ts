// Why the name of a new population was refused, as the core's
// PopulationRefusal crosses to a window inside a refusal
// (crates/vavilov-core/src/error/population.rs): a kind and its fields, in
// camelCase. The table below is the one list of them on this side, and the
// type is made from it.

import { isLevelCode } from "./ids.ts";
import type { LevelCode } from "./ids.ts";
import { hasFieldsOf } from "./tagged.ts";

/** The type of a field of a refusal of a population's name. */
type FieldType = "levelCode" | "number" | "string";

/** The fields of each kind of refusal of a population's name. */
const POPULATION_FIELDS = {
  emptyName: {},
  taken: { code: "levelCode" },
  notWholeNumber: {},
  notDecimalNumber: { decimalMark: "string" },
  notACountry: {},
  notYesOrNo: {},
  tooLong: { maxChars: "number" },
  controlCharacter: {},
  tooMany: { maxLevels: "number" },
} as const satisfies Record<string, Record<string, FieldType>>;

type PopulationFields = typeof POPULATION_FIELDS;

/** The TypeScript type of each type of field. */
interface TypeOf {
  readonly levelCode: LevelCode;
  readonly number: number;
  readonly string: string;
}

/** Why a name typed for a new population does not fit the classification; nothing was added. */
export type PopulationRefusal = {
  [K in keyof PopulationFields]: { readonly kind: K } & {
    readonly [F in keyof PopulationFields[K]]: PopulationFields[K][F] extends FieldType
      ? TypeOf[PopulationFields[K][F]]
      : never;
  };
}[keyof PopulationFields];

const POPULATION_OF_KIND: ReadonlyMap<string, Readonly<Record<string, FieldType>>> = new Map(
  Object.entries(POPULATION_FIELDS),
);

function hasType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "levelCode":
      return typeof value === "number" && isLevelCode(value);
    case "number":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    case "string":
      return typeof value === "string";
  }
}

/** Whether `value` is a refusal of a population's name, with exactly the fields of its kind. */
export function isPopulationRefusal(value: unknown): value is PopulationRefusal {
  return hasFieldsOf(value, POPULATION_OF_KIND, hasType);
}
