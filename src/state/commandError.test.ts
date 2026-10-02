import { describe, expect, test } from "vitest";

import { isCommandError } from "./commandError.ts";

describe("a refusal of the backend", () => {
  test("is recognised by its kind and exactly its fields", () => {
    expect(isCommandError({ kind: "noProject" })).toBe(true);
    expect(isCommandError({ kind: "unknownLevel", column: 3, code: 7, numLevels: 2 })).toBe(true);
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
    expect(isCommandError("noProject")).toBe(false);
    expect(isCommandError(null)).toBe(false);
    expect(isCommandError(new Error("noProject"))).toBe(false);
  });
});
