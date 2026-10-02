import { describe, expect, test } from "vitest";

import {
  csvDefaults,
  decimalMarksWith,
  exportAnswerOf,
  fittedCsvChoices,
  importAnswerOf,
} from "./transfer.ts";

describe("the choices of a CSV", () => {
  test("start from ; and a comma where numbers have a decimal comma, and , and a point elsewhere", () => {
    expect(csvDefaults(",")).toEqual({
      separator: "semicolon",
      decimal: "comma",
      encoding: "utf8WithMark",
      missing: "empty",
    });
    expect(csvDefaults(".")).toEqual({
      separator: "comma",
      decimal: "point",
      encoding: "utf8WithMark",
      missing: "empty",
    });
  });

  test("offer only the point as the decimal mark when the comma is the separator", () => {
    expect(decimalMarksWith("comma")).toEqual(["point"]);
    expect(decimalMarksWith("semicolon")).toEqual(["comma", "point"]);
    expect(decimalMarksWith("tab")).toEqual(["comma", "point"]);
  });

  test("move a decimal comma to the point when the comma becomes the separator", () => {
    const choices = {
      separator: "comma",
      decimal: "comma",
      encoding: "windows1252",
      missing: "na",
    } as const;
    expect(fittedCsvChoices(choices)).toEqual({ ...choices, decimal: "point" });
    expect(fittedCsvChoices({ ...choices, separator: "tab" })).toEqual({
      ...choices,
      separator: "tab",
    });
  });
});

describe("the answers of an import and an export", () => {
  test("are those the backend writes, and nothing else", () => {
    expect(importAnswerOf({ kind: "cancelled" })).toEqual({ kind: "cancelled" });
    expect(
      importAnswerOf({ kind: "imported", fileName: "plants.csv", undecodedLine: null }),
    ).toEqual({ kind: "imported", fileName: "plants.csv", undecodedLine: null });
    expect(importAnswerOf({ kind: "imported", fileName: "plants.csv" })).toBeNull();
    expect(importAnswerOf({ kind: "cancelled", fileName: "x" })).toBeNull();
    expect(exportAnswerOf({ kind: "exported", fileName: "plants.xlsx" })).toEqual({
      kind: "exported",
      fileName: "plants.xlsx",
    });
    expect(exportAnswerOf({ kind: "exported", fileName: 3 })).toBeNull();
  });

  test("have a line that is a whole number or null, and no field of another kind", () => {
    expect(importAnswerOf({ kind: "imported", fileName: "plants.csv", undecodedLine: 3 })).toEqual({
      kind: "imported",
      fileName: "plants.csv",
      undecodedLine: 3,
    });
    expect(
      importAnswerOf({ kind: "imported", fileName: "plants.csv", undecodedLine: 1.5 }),
    ).toBeNull();
    expect(importAnswerOf({ kind: "exported", fileName: "plants.csv" })).toBeNull();
    expect(exportAnswerOf({ kind: "imported", fileName: "a", undecodedLine: null })).toBeNull();
    expect(exportAnswerOf({ kind: "exported", fileName: "a", undecodedLine: null })).toBeNull();
    expect(exportAnswerOf({ kind: "cancelled" })).toEqual({ kind: "cancelled" });
    expect(exportAnswerOf("cancelled")).toBeNull();
  });
});
