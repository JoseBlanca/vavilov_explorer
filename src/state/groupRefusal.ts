// Why the name of a new group was refused, as the core's
// GroupRefusal crosses to a window inside a refusal
// (crates/vavilov-core/src/error/group.rs): a kind and its fields, in
// camelCase. The table below is the one list of them on this side, and the
// type is made from it.

import { isCount, isLevelCodeField, isText, taggedDecoder } from "./tagged.ts";
import type { Tagged } from "./tagged.ts";

/** The fields of each kind of refusal of a group's name. */
const GROUP_FIELDS = {
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

/** Why a name typed for a group does not fit the classification; nothing was changed. */
export type GroupRefusal = Tagged<typeof GROUP_FIELDS>;

/** Whether `value` is a refusal of a group's name, with exactly the fields of its kind. */
export const isGroupRefusal: (value: unknown) => value is GroupRefusal =
  taggedDecoder(GROUP_FIELDS);
