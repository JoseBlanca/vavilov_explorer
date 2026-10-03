import { describe, expect, test } from "vitest";

import { isCommandError } from "./commandError.ts";
import { populationRefusalMessage } from "./populationMessages.ts";
import type { PopulationRefused } from "./populationMessages.ts";
// The refusals of populations the core's test serialises and compares with
// the same file (crates/vavilov-core/src/error/tests.rs), so that a field
// renamed on either side fails a test.
import POPULATION_ERRORS from "../../crates/vavilov-core/src/error/population-errors.json?raw";

/** The refusals of the shared file, each checked as a window checks one. */
function populationErrors(): readonly PopulationRefused[] {
  const parsed: unknown = JSON.parse(POPULATION_ERRORS);
  if (!Array.isArray(parsed)) {
    throw new Error("the file of refusals is not an array");
  }
  return parsed.map((value: unknown) => {
    if (!isCommandError(value) || value.kind !== "populationRefused") {
      throw new Error(`not a refusal of a population: ${JSON.stringify(value)}`);
    }
    return value;
  });
}

/** What the name was typed for: a new group. */
const ADDING = { kind: "add" } as const;

/** The groups of the classification, by code, as the panel names them. */
const GROUPS = ["ESP", "PER"];

describe("the words of a group's name that was refused", () => {
  test("say what was typed, in which column, and what to type instead", () => {
    expect(
      populationErrors().map((error) =>
        populationRefusalMessage(
          error,
          (code) => GROUPS[code] ?? null,
          (value) => value.toLocaleString("en"),
          ADDING,
        ),
      ),
    ).toEqual(
      [
        "No group was added to “origin”: a group needs a name. Type one, then press Enter.",
        "“Kingdom of Spain” was not added to “origin”, which has the group ESP already.",
        "“1,5” was not added to “seeds”, whose groups are whole numbers, such as 12. Type a whole number.",
        "“2.5” was not added to “height”, whose groups are decimal numbers written with “,” as the decimal mark, such as 2,5. Type a number so.",
        "“Atlantis” was not added to “origin”: it names no country of ISO 3166. Type a country's ISO name or code, such as Spain or ESP.",
        "“maybe” was not added to “fertile”, which holds TRUE or FALSE. Type the one it does not have yet.",
        "“one more” was not added to “group”, which has 65,535 groups, the most a column can have.",
        "“Kingdom of the Netherlands, the” was not added to “origin”: a group's name has at most 30 characters. Type a shorter name.",
        "“Peru\nChile” was not added to “origin”: a group's name cannot hold a line break, a tab or a mark that changes the direction of the text. Type the name again without it.",
      ].map((text) => ({ kind: "error", text })),
    );
  });

  test("of a name taken by a group the window does not have yet say so without its name", () => {
    const [, taken] = populationErrors();
    if (taken === undefined) {
      throw new Error("no refusal of a name taken");
    }
    expect(
      populationRefusalMessage(
        taken,
        () => null,
        (value) => String(value),
        ADDING,
      ),
    ).toEqual({
      kind: "error",
      text: "“Kingdom of Spain” was not added to “origin”, which has that group already.",
    });
  });

  test("of a group edited say which group kept its name, and what to type instead", () => {
    const editing = populationErrors().filter((error) => error.refusal.kind !== "tooMany");
    expect(
      editing.map((error) =>
        populationRefusalMessage(
          error,
          (code) => GROUPS[code] ?? null,
          (value) => value.toLocaleString("en"),
          { kind: "edit", name: "PER" },
        ),
      ),
    ).toEqual(
      [
        "PER was not renamed: a group needs a name. Type one, then press Enter.",
        "PER was not renamed “Kingdom of Spain”: “origin” has the group ESP already.",
        "PER was not renamed “1,5”: the groups of “seeds” are whole numbers, such as 12. Type a whole number.",
        "PER was not renamed “2.5”: the groups of “height” are decimal numbers written with “,” as the decimal mark, such as 2,5. Type a number so.",
        "PER was not renamed “Atlantis”: it names no country of ISO 3166. Type a country's ISO name or code, such as Spain or ESP.",
        "PER was not renamed “maybe”: “fertile” holds TRUE or FALSE. Type the one it does not have yet.",
        "PER was not renamed “Kingdom of the Netherlands, the”: a group's name has at most 30 characters. Type a shorter name.",
        "PER was not renamed “Peru\nChile”: a group's name cannot hold a line break, a tab or a mark that changes the direction of the text. Type the name again without it.",
      ].map((text) => ({ kind: "error", text })),
    );
  });

  test("of a group edited, with too many groups, is a defect", () => {
    const tooMany = populationErrors().find((error) => error.refusal.kind === "tooMany");
    if (tooMany === undefined) {
      throw new Error("no refusal of too many groups");
    }
    expect(() =>
      populationRefusalMessage(tooMany, () => null, String, { kind: "edit", name: "PER" }),
    ).toThrow(/defect/);
  });

  test("of a refusal that is not of a population fail to decode", () => {
    expect(
      isCommandError({
        kind: "populationRefused",
        columnName: "origin",
        text: "x",
        refusal: { kind: "taken" },
      }),
    ).toBe(false);
    expect(
      isCommandError({
        kind: "populationRefused",
        columnName: "origin",
        text: "x",
        refusal: { kind: "taken", code: 65535 },
      }),
    ).toBe(false);
  });
});
