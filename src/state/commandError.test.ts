import { describe, expect, test } from "vitest";

import { isCommandError } from "./commandError.ts";

describe("a refusal of the backend", () => {
  test("is recognised by its kind and exactly its fields", () => {
    expect(isCommandError({ kind: "noProject" })).toBe(true);
    expect(isCommandError({ kind: "notSelected", target: { population: 1 } })).toBe(true);
    expect(isCommandError({ kind: "notSelected", target: "unassigned" })).toBe(true);
    expect(isCommandError({ kind: "nonFiniteNumber", columnName: "height", row: 1 })).toBe(true);
    expect(isCommandError({ kind: "nonFiniteNumber", column: "height", row: 1 })).toBe(false);
    expect(isCommandError({ kind: "unknownLevel", column: 3, code: 7, numLevels: 2 })).toBe(true);
    expect(isCommandError({ kind: "notIndividualId", header: "accession" })).toBe(true);
    expect(
      isCommandError({ kind: "roleNotPossible", column: 3, storage: "text", role: "number" }),
    ).toBe(true);
    expect(
      isCommandError({ kind: "roleNotPossible", column: 3, storage: "date", role: "number" }),
    ).toBe(false);
    expect(
      isCommandError({ kind: "duplicateIndividual", name: "p2", firstRow: 1, secondRow: 3 }),
    ).toBe(true);
  });

  test("is not one with an unknown kind, a missing, extra or mistyped field", () => {
    expect(isCommandError({ kind: "unknownThing" })).toBe(false);
    expect(isCommandError({ kind: "toString" })).toBe(false);
    expect(isCommandError({ kind: "unknownLevel", column: 3, code: 7 })).toBe(false);
    expect(isCommandError({ kind: "noProject", column: 3 })).toBe(false);
    expect(isCommandError({ kind: "unknownColumn", column: "3" })).toBe(false);
    expect(isCommandError({ kind: "unknownLevel", column: 3, code: 7, toString: 2 })).toBe(false);
    // An id out of its range: u32::MAX means no column, 0xFFFF no code.
    expect(isCommandError({ kind: "unknownColumn", column: 0xffff_ffff })).toBe(false);
    expect(isCommandError({ kind: "notSelected", target: { population: 0xffff } })).toBe(false);
    expect(isCommandError({ kind: "notSelected", target: "everyone" })).toBe(false);
    expect(isCommandError({ kind: "notSelected", target: { population: 1, extra: 2 } })).toBe(
      false,
    );
    expect(isCommandError({ kind: "rowSetLength", numRows: -1, numBytes: 2 })).toBe(false);
    expect(isCommandError("noProject")).toBe(false);
    expect(isCommandError(null)).toBe(false);
    expect(isCommandError(new Error("noProject"))).toBe(false);
  });
});
