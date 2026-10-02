// The roles a column can take, as the dropdown on top of it offers them:
// only those its storage type can take, and a category or a classification
// only when its distinct values fit the codes (docs/design.md, section 6).
// A role the column cannot take is not offered, as the owner decided on
// 2 October 2026.

import type { ColumnDescription, Role } from "./description.ts";
import { ROLES } from "./description.ts";

/** The most levels a category or a classification may have, `MAX_LEVELS` of the core. */
export const MAX_LEVELS = 65_535;

/** A role as the dropdown offers it. */
export interface RoleChoice {
  /** The role. */
  readonly role: Role;
  /** Its name, as the user reads it. */
  readonly label: string;
}

const LABELS: Readonly<Record<Role, string>> = {
  number: "Number",
  category: "Category",
  classification: "Classification",
  text: "Text",
};

/** The roles `column` can take, its own among them, in the order of `ROLES`. */
export function roleChoices(column: ColumnDescription): RoleChoice[] {
  return ROLES.filter((role) => canTake(column, role)).map((role) => ({
    role,
    label: LABELS[role],
  }));
}

function canTake(column: ColumnDescription, role: Role): boolean {
  const { storage } = column;
  switch (role) {
    case "number":
      return storage === "integer" || storage === "float";
    case "text":
      return storage === "text";
    case "category":
    case "classification":
      return (
        column.role === "category" ||
        column.role === "classification" ||
        column.numDistinct <= MAX_LEVELS
      );
  }
}
