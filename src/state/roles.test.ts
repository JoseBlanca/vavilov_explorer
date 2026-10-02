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

describe("the roles a column is offered", () => {
  test("are those the core says it can take, in its order, with the words the user reads", () => {
    const origin: ColumnDescription = {
      ...COMMON,
      storage: "text",
      role: "country",
      roles: ["category", "country", "text"],
      levels: [],
    };
    expect(roleChoices(origin)).toEqual([
      { role: "category", label: "Category" },
      { role: "country", label: "Country" },
      { role: "text", label: "Text" },
    ]);
  });

  test("of a latitude include its sub-roles as numbers", () => {
    const latitude: ColumnDescription = {
      ...COMMON,
      storage: "float",
      role: "latitude",
      roles: ["number", "latitude", "longitude"],
    };
    expect(roleChoices(latitude).map((choice) => choice.label)).toEqual([
      "Number",
      "Latitude",
      "Longitude",
    ]);
  });
});
