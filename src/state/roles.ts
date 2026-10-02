// The roles a column can take, as the dropdown on top of it offers them:
// those the core says the column can take (`roles` in the description), with
// the words the user reads. A role the column cannot take is not offered, as
// the owner decided on 2 October 2026 (docs/design.md, section 6).

import { isCategorical } from "./description.ts";
import type { ColumnDescription, Role } from "./description.ts";
import type { ColumnId } from "./ids.ts";
import type { Question } from "./question.ts";

/** A role as the dropdown offers it. */
export interface RoleChoice {
  /** The role. */
  readonly role: Role;
  /** Its name, as the user reads it. */
  readonly label: string;
}

const LABELS: Readonly<Record<Role, string>> = {
  number: "Number",
  latitude: "Latitude",
  longitude: "Longitude",
  category: "Category",
  country: "Country",
  text: "Text",
};

/** The roles `column` can take, its own among them, in the order the core gives them. */
export function roleChoices(column: ColumnDescription): RoleChoice[] {
  return column.roles.map((role) => ({ role, label: LABELS[role] }));
}

/**
 * The question a change of `column` to `role` asks first, or `null`: a
 * change that stops the active classification, `active`, asks, since one
 * key in the dropdown is enough to make it, as the owner decided on
 * 2 October 2026 (docs/design.md, section 6).
 */
export function roleChangeQuestion(
  column: ColumnDescription,
  role: Role,
  active: ColumnId | null,
): Question | null {
  if (active !== column.id || isCategorical(role)) {
    return null;
  }
  const name = `“${column.name}”`;
  return {
    heading: `Make ${name} ${AS_PHRASE[role]}?`,
    text: `${name} is the classification column, and ${AS_SUBJECT[role]} cannot be one. Its values are kept, but the panel's Classification column will show None until you choose a category there; to choose ${name} again, make it a category.`,
    confirm: `Make it ${AS_PHRASE[role]}`,
    cancel: `Keep it ${AS_PHRASE[column.role]}`,
  };
}

/** Each role as the subject of a sentence. */
const AS_SUBJECT: Readonly<Record<Role, string>> = {
  number: "a number",
  latitude: "a latitude",
  longitude: "a longitude",
  category: "a category",
  country: "a country",
  text: "text",
};

/** Each role as it follows "make it" in a sentence. */
const AS_PHRASE: Readonly<Record<Role, string>> = {
  number: "a number",
  latitude: "a latitude",
  longitude: "a longitude",
  category: "a category",
  country: "a country",
  text: "text",
};
