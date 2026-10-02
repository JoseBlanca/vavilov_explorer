import { describe, expect, test } from "vitest";

import type { ColumnDescription } from "./description.ts";
import { isColumnId, isRevision } from "./ids.ts";
import type { ColumnId, Revision } from "./ids.ts";
import { roleChangeQuestion, roleChoices } from "./roles.ts";

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

describe("a change of role", () => {
  const origin: ColumnDescription = {
    id: column(2),
    name: "origin",
    revision: revision(1),
    storage: "text",
    role: "category",
    roles: ["category", "country", "text"],
    levels: [],
  };

  test("that stops the active classification asks first, in the words of the column", () => {
    expect(roleChangeQuestion(origin, "text", column(2))).toEqual({
      heading: "Make “origin” text?",
      text: "“origin” is the classification column, and text cannot be one. Its values are kept, but the panel's Classification column will show None until you choose a category there; to choose “origin” again, make it a category.",
      confirm: "Make it text",
      cancel: "Keep it a category",
    });
    const seeds: ColumnDescription = {
      id: column(3),
      name: "seeds",
      revision: revision(1),
      storage: "integer",
      role: "category",
      roles: ["number", "latitude", "category"],
      levels: [],
    };
    expect(roleChangeQuestion(seeds, "latitude", column(3))).toMatchObject({
      heading: "Make “seeds” a latitude?",
      confirm: "Make it a latitude",
      cancel: "Keep it a category",
    });
    const countries: ColumnDescription = { ...origin, role: "country" };
    expect(roleChangeQuestion(countries, "text", column(2))).toMatchObject({
      cancel: "Keep it a country",
    });
  });

  test("that keeps a category, or is of another column, asks nothing", () => {
    expect(roleChangeQuestion(origin, "country", column(2))).toBeNull();
    expect(roleChangeQuestion(origin, "text", column(4))).toBeNull();
    expect(roleChangeQuestion(origin, "text", null)).toBeNull();
  });
});
