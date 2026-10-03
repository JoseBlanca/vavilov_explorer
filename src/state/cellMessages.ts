// The words the user reads when a value typed in a cell of the table is
// refused, written from the kind and the data of the backend's refusal
// (.claude/skills/writing/SKILL.md, "The text of the app";
// docs/design.md, section 2.1). Every cell kept its value.

import type { BarMessage } from "./barMessages.ts";
import type { CommandError } from "./commandError.ts";

/** A refusal of a value typed in a cell, as the backend gives it. */
export type CellRefused = Extract<CommandError, { readonly kind: "cellRefused" }>;

/** The error the information bar shows for a value typed in a cell that was refused. */
export function cellRefusalMessage(error: CellRefused): BarMessage {
  return { kind: "error", text: cellRefusalText(error) };
}

function cellRefusalText(error: CellRefused): string {
  const typed = `“${error.text}” was not put in “${error.columnName}”`;
  const { refusal } = error;
  switch (refusal.kind) {
    case "notWholeNumber":
      return `${typed}, which holds whole numbers, such as 12. Type a whole number, or nothing for a missing value.`;
    case "notDecimalNumber":
      return `${typed}, which holds decimal numbers written with “${refusal.decimalMark}” as the decimal mark, such as 2${refusal.decimalMark}5. Type a number so, or nothing for a missing value.`;
    case "notLatitude":
      return `${typed}: a latitude is from −90 to 90. Type a latitude in decimal degrees, or nothing for a missing value.`;
    case "notLongitude":
      return `${typed}: a longitude is from −180 to 180. Type a longitude in decimal degrees, or nothing for a missing value.`;
    case "notYesOrNo":
      return `${typed}, which holds TRUE or FALSE. Type one of them, or nothing for a missing value.`;
    case "notACountry":
      return `${typed}: it names no country of ISO 3166. Type a country's ISO name or code, such as Spain or ESP.`;
    case "notALevel":
      return `${typed}: it is none of the column's values. Type one of the values the cell suggests.`;
    case "emptyId":
      return "The ID was not changed: every individual needs an ID.";
    case "idTaken":
      return `The ID was not changed: another individual's ID is “${error.text}”, and no two individuals may share one.`;
  }
}
