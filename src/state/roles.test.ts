import { describe, expect, test } from "vitest";

import type { ColumnDescription } from "./description.ts";
import { isColumnId, isRevision } from "./ids.ts";
import type { ColumnId, Revision } from "./ids.ts";
import { roleChoices } from "./roles.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}
function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error("not a revision");
  return value;
}

const COMMON = { id: column(1), name: "x", revision: revision(1) } as const;

function roles(description: ColumnDescription): string[] {
  return roleChoices(description).map((choice) => choice.role);
}

describe("the roles a column is offered", () => {
  test("a number of whole or decimal numbers can be a number, a category or a classification", () => {
    for (const storage of ["integer", "float"] as const) {
      expect(roles({ ...COMMON, storage, role: "number", numDistinct: 4 })).toEqual([
        "number",
        "category",
        "classification",
      ]);
    }
  });

  test("text can be a category, a classification or text, never a number", () => {
    expect(roles({ ...COMMON, storage: "text", role: "text", numDistinct: 4 })).toEqual([
      "category",
      "classification",
      "text",
    ]);
  });

  test("yes or no can be a category or a classification only", () => {
    expect(roles({ ...COMMON, storage: "boolean", role: "category", levels: [] })).toEqual([
      "category",
      "classification",
    ]);
  });

  test("a column of more distinct values than a code holds cannot be a category", () => {
    expect(roles({ ...COMMON, storage: "text", role: "text", numDistinct: 65_536 })).toEqual([
      "text",
    ]);
    expect(roles({ ...COMMON, storage: "integer", role: "number", numDistinct: 65_535 })).toEqual([
      "number",
      "category",
      "classification",
    ]);
  });

  test("are labelled for the user", () => {
    expect(
      roleChoices({ ...COMMON, storage: "integer", role: "number", numDistinct: 1 }).map(
        (choice) => choice.label,
      ),
    ).toEqual(["Number", "Category", "Classification"]);
  });
});
