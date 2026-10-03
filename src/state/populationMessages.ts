// The words the user reads when the name typed for a new group, or for a
// group edited, is refused,
// written from the kind and the data of the backend's refusal
// (.claude/skills/writing/SKILL.md, "The text of the app";
// docs/design.md, section 2.1). Nothing was added. The words say "group",
// as the owner decided on 3 October 2026, ahead of a rename of population
// to group across the app.

import type { BarMessage } from "./barMessages.ts";
import { defect } from "./defect.ts";
import type { CommandError } from "./commandError.ts";
import type { LevelCode } from "./ids.ts";

/** What a group's name was typed for: a new group, or the group `name` edited. */
export type TypedFor = { readonly kind: "add" } | { readonly kind: "edit"; readonly name: string };

/** A refusal of a new population's name, as the backend gives it. */
export type PopulationRefused = Extract<CommandError, { readonly kind: "populationRefused" }>;

/**
 * The error the information bar shows for a group's name that was refused,
 * with `groupName` writing the name of a group of the classification as the
 * panel shows it, or `null` when the window's copy does not have it yet,
 * and `countWords` a number in the user's language.
 */
export function populationRefusalMessage(
  error: PopulationRefused,
  groupName: (code: LevelCode) => string | null,
  countWords: (value: number) => string,
  typedFor: TypedFor,
): BarMessage {
  const text =
    typedFor.kind === "add"
      ? refusalText(error, groupName, countWords)
      : editRefusalText(error, typedFor.name, groupName, countWords);
  return { kind: "error", text };
}

function refusalText(
  error: PopulationRefused,
  groupName: (code: LevelCode) => string | null,
  countWords: (value: number) => string,
): string {
  const column = `“${error.columnName}”`;
  const typed = `“${error.text}” was not added to ${column}`;
  const { refusal } = error;
  switch (refusal.kind) {
    case "emptyName":
      return `No group was added to ${column}: a group needs a name. Type one, then press Enter.`;
    case "taken": {
      const taken = groupName(refusal.code);
      return taken === null
        ? `${typed}, which has that group already.`
        : `${typed}, which has the group ${taken} already.`;
    }
    case "notWholeNumber":
      return `${typed}, whose groups are whole numbers, such as 12. Type a whole number.`;
    case "notDecimalNumber":
      return `${typed}, whose groups are decimal numbers written with “${refusal.decimalMark}” as the decimal mark, such as 2${refusal.decimalMark}5. Type a number so.`;
    case "notACountry":
      return `${typed}: it names no country of ISO 3166. Type a country's ISO name or code, such as Spain or ESP.`;
    case "notYesOrNo":
      return `${typed}, which holds TRUE or FALSE. Type the one it does not have yet.`;
    case "tooLong":
      return `${typed}: a group's name has at most ${countWords(refusal.maxChars)} characters. Type a shorter name.`;
    case "controlCharacter":
      return `${typed}: a group's name cannot hold a line break, a tab or a mark that changes the direction of the text. Type the name again without it.`;
    case "tooMany":
      return `${typed}, which has ${countWords(refusal.maxLevels)} groups, the most a column can have.`;
  }
}

/**
 * The words of a refusal of the name typed for the group `name`, edited.
 *
 * @throws A defect for a refusal of too many groups, which only a group
 * added can meet.
 */
function editRefusalText(
  error: PopulationRefused,
  name: string,
  groupName: (code: LevelCode) => string | null,
  countWords: (value: number) => string,
): string {
  const column = `“${error.columnName}”`;
  const typed = `${name} was not renamed “${error.text}”`;
  const { refusal } = error;
  switch (refusal.kind) {
    case "emptyName":
      return `${name} was not renamed: a group needs a name. Type one, then press Enter.`;
    case "taken": {
      const taken = groupName(refusal.code);
      return taken === null
        ? `${typed}: ${column} has that group already.`
        : `${typed}: ${column} has the group ${taken} already.`;
    }
    case "notWholeNumber":
      return `${typed}: the groups of ${column} are whole numbers, such as 12. Type a whole number.`;
    case "notDecimalNumber":
      return `${typed}: the groups of ${column} are decimal numbers written with “${refusal.decimalMark}” as the decimal mark, such as 2${refusal.decimalMark}5. Type a number so.`;
    case "notACountry":
      return `${typed}: it names no country of ISO 3166. Type a country's ISO name or code, such as Spain or ESP.`;
    case "notYesOrNo":
      return `${typed}: ${column} holds TRUE or FALSE. Type the one it does not have yet.`;
    case "tooLong":
      return `${typed}: a group's name has at most ${countWords(refusal.maxChars)} characters. Type a shorter name.`;
    case "controlCharacter":
      return `${typed}: a group's name cannot hold a line break, a tab or a mark that changes the direction of the text. Type the name again without it.`;
    case "tooMany":
      throw defect(`the group ${name} edited, refused for too many groups`);
  }
}
