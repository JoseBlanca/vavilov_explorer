// Why the name of a new population was refused, as the core's
// PopulationRefusal crosses to a window inside a refusal
// (crates/vavilov-core/src/error/population.rs): a kind and its fields, in
// camelCase. The table below is the one list of them on this side, and the
// type is made from it.

import { isCount, isLevelCodeField, isText, taggedDecoder } from "./tagged.ts";
import type { Tagged } from "./tagged.ts";

/** The fields of each kind of refusal of a population's name. */
const POPULATION_FIELDS = {
  emptyName: {},
  taken: { code: isLevelCodeField },
  notWholeNumber: {},
  notDecimalNumber: { decimalMark: isText },
  notACountry: {},
  notYesOrNo: {},
  tooLong: { maxChars: isCount },
  controlCharacter: {},
  tooMany: { maxLevels: isCount },
};

/** Why a name typed for a population does not fit the classification; nothing was changed. */
export type PopulationRefusal = Tagged<typeof POPULATION_FIELDS>;

/** Whether `value` is a refusal of a population's name, with exactly the fields of its kind. */
export const isPopulationRefusal: (value: unknown) => value is PopulationRefusal =
  taggedDecoder(POPULATION_FIELDS);
