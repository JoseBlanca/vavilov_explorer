// The roles a column can take, as the dropdown on top of it offers them:
// those the core says the column can take (`roles` in the description), with
// the words the user reads. A role the column cannot take is not offered, as
// the owner decided on 2 October 2026 (docs/design.md, section 6).

import type { ColumnDescription, Role } from "./description.ts";

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
  countryCategory: "Country category",
  classification: "Classification",
  countryClassification: "Country classification",
  text: "Text",
};

/** The roles `column` can take, its own among them, in the order the core gives them. */
export function roleChoices(column: ColumnDescription): RoleChoice[] {
  return column.roles.map((role) => ({ role, label: LABELS[role] }));
}
