import { describe, expect, test } from "vitest";

import { cellRefusalMessage } from "./cellMessages.ts";
import type { CellRefused } from "./cellMessages.ts";
import { isCommandError } from "./commandError.ts";
// The refusals of cells the core's test serialises and compares with the
// same file (crates/vavilov-core/src/error/tests.rs), so that a field
// renamed on either side fails a test.
import CELL_ERRORS from "../../crates/vavilov-core/src/error/cell-errors.json?raw";

/** The refusals of the shared file, each checked as a window checks one. */
function cellErrors(): readonly CellRefused[] {
  const parsed: unknown = JSON.parse(CELL_ERRORS);
  if (!Array.isArray(parsed)) {
    throw new Error("the file of refusals is not an array");
  }
  return parsed.map((value: unknown) => {
    if (!isCommandError(value) || value.kind !== "cellRefused") {
      throw new Error(`not a refusal of a cell: ${JSON.stringify(value)}`);
    }
    return value;
  });
}

describe("the words of a value typed in a cell that was refused", () => {
  test("say what was typed, in which column, and what the column takes", () => {
    expect(cellErrors().map((error) => cellRefusalMessage(error))).toEqual(
      [
        "“1,5” was not put in “seeds”, which holds whole numbers, such as 12. Type a whole number, or nothing for a missing value.",
        "“1.5” was not put in “height”, which holds decimal numbers written with “,” as the decimal mark, such as 2,5. Type a number so, or nothing for a missing value.",
        "“91” was not put in “lat”: a latitude is from −90 to 90. Type a latitude in decimal degrees, or nothing for a missing value.",
        "“-181” was not put in “lon”: a longitude is from −180 to 180. Type a longitude in decimal degrees, or nothing for a missing value.",
        "“yes” was not put in “fertile”, which holds TRUE or FALSE. Type one of them, or nothing for a missing value.",
        "“Atlantis” was not put in “origin”: it names no country of ISO 3166. Type a country's ISO name or code, such as Spain or ESP.",
        "“Chile” was not put in “origin”: it is none of the column's values. Type one of the values the cell suggests.",
        "The ID was not changed: every individual needs an ID.",
        "The ID was not changed: another individual's ID is “p2”, and no two individuals may share one.",
      ].map((text) => ({ kind: "error", text })),
    );
  });

  test("of a refusal that is not of a cell fail to decode", () => {
    expect(
      isCommandError({
        kind: "cellRefused",
        columnName: "seeds",
        text: "x",
        refusal: { kind: "notAValue" },
      }),
    ).toBe(false);
    expect(
      isCommandError({
        kind: "cellRefused",
        columnName: "seeds",
        text: "x",
        refusal: { kind: "notDecimalNumber" },
      }),
    ).toBe(false);
  });
});
