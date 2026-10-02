import { describe, expect, test } from "vitest";

import { isCommandError } from "./commandError.ts";
// The errors about a file the core's test serialises and compares with the
// same file (crates/vavilov-core/src/error/tests.rs), so that a field
// renamed on either side fails a test.
import FILE_ERRORS from "../../crates/vavilov-core/src/error/file-errors.json?raw";

/** The objects of the shared file. */
function fileErrors(): readonly Readonly<Record<string, unknown>>[] {
  const parsed: unknown = JSON.parse(FILE_ERRORS);
  if (!Array.isArray(parsed)) {
    throw new Error("the file of errors is not an array");
  }
  return parsed.map((value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`not an object: ${JSON.stringify(value)}`);
    }
    return Object.fromEntries(Object.entries(value));
  });
}

/** `object` with its first field other than `kind` renamed, or `kind` itself when it has none. */
function withFieldRenamed(object: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const names = Object.keys(object);
  const renamed = names.find((name) => name !== "kind") ?? "kind";
  return Object.fromEntries(
    Object.entries(object).map(([name, value]) => [
      name === renamed ? `${name}Renamed` : name,
      value,
    ]),
  );
}

/** `error` with one field renamed: of its refusal when it has one, else of its own. */
function withOneFieldRenamed(error: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const refusal = error["refusal"];
  if (typeof refusal === "object" && refusal !== null && !Array.isArray(refusal)) {
    return { ...error, refusal: withFieldRenamed(Object.fromEntries(Object.entries(refusal))) };
  }
  return withFieldRenamed(error);
}

describe("the errors about a file, as the core serialises them", () => {
  test("the shared file holds every case of an error about a file", () => {
    const kinds = new Set(fileErrors().map((error) => error["kind"]));
    expect([...kinds].sort()).toEqual([
      "exportRefused",
      "fileNotRead",
      "fileNotWritten",
      "importRefused",
      "importUnreadable",
    ]);
    expect(fileErrors()).toHaveLength(34);
  });

  test("each is a refusal the window knows", () => {
    for (const error of fileErrors()) {
      expect(isCommandError(error), JSON.stringify(error)).toBe(true);
    }
  });

  test("each with one field renamed is not", () => {
    for (const error of fileErrors()) {
      const renamed = withOneFieldRenamed(error);
      expect(isCommandError(renamed), JSON.stringify(renamed)).toBe(false);
    }
  });
});
