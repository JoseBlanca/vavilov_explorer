import { describe, expect, test } from "vitest";

import { isColumnId } from "./ids.ts";
import type { ColumnId } from "./ids.ts";
import { noColumnMessage, noNumbersMessage, widgetRefusalMessage } from "./widgetMessages.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}

const NAMES = new Map([
  [2, "PC1"],
  [3, "lat"],
  [4, "origin"],
]);
const nameOf = (id: number): string | null => NAMES.get(id) ?? null;

describe("the words of a 3D scatter that was not opened", () => {
  test("name the column that is no longer of numbers", () => {
    expect(
      widgetRefusalMessage(
        "scatter3d",
        { kind: "unfit", column: column(2), role: "number" },
        nameOf,
      ),
    ).toEqual({
      kind: "error",
      text: "No 3D scatter was opened: “PC1” is no longer a column of numbers.",
    });
    expect(
      widgetRefusalMessage(
        "scatter3d",
        { kind: "unfit", column: column(9), role: "number" },
        nameOf,
      ).text,
    ).toBe("No 3D scatter was opened: one of its columns is no longer a column of numbers.");
  });

  test("say the system could not open the window, without its technical message", () => {
    const message = widgetRefusalMessage(
      "scatter3d",
      { kind: "windowFailed", label: "scatter3d-1", message: "NSWindow failed" },
      nameOf,
    );
    expect(message.kind).toBe("error");
    expect(message.text).toBe(
      "No 3D scatter was opened: the system could not open its window. Closing other windows may let it open.",
    );
  });

  test("with no column of numbers say how to make one", () => {
    expect(noNumbersMessage("scatter3d").text).toBe(
      "No 3D scatter was opened: the table has no column of numbers. A column of numbers shown as a category becomes one when “number” is chosen as its role.",
    );
    expect(noNumbersMessage("histogram").text).toBe(
      "No histogram was opened: the table has no column of numbers. A column of numbers shown as a category becomes one when “number” is chosen as its role.",
    );
  });

  test("of a histogram name it", () => {
    expect(
      widgetRefusalMessage(
        "histogram",
        { kind: "unfit", column: column(4), role: "number" },
        nameOf,
      ).text,
    ).toMatch(/^No histogram was opened: /);
  });
});

describe("the words of a map that was not opened", () => {
  test("name the column that is no longer of its role", () => {
    expect(
      widgetRefusalMessage("map", { kind: "unfit", column: column(3), role: "latitude" }, nameOf),
    ).toEqual({
      kind: "error",
      text: "No map was opened: “lat” is no longer a latitude column.",
    });
    expect(
      widgetRefusalMessage(
        "countryMap",
        { kind: "unfit", column: column(4), role: "country" },
        nameOf,
      ).text,
    ).toBe("No map of countries was opened: “origin” is no longer a column of countries.");
    expect(
      widgetRefusalMessage("map", { kind: "unfit", column: column(9), role: "longitude" }, nameOf)
        .text,
    ).toBe("No map was opened: one of its columns is no longer a longitude column.");
  });

  test("name its kind when the system could not open its window", () => {
    expect(
      widgetRefusalMessage(
        "countryMap",
        { kind: "windowFailed", label: "countryMap-1", message: "no display" },
        nameOf,
      ).text,
    ).toBe(
      "No map of countries was opened: the system could not open its window. Closing other windows may let it open.",
    );
  });

  test("with no column of a role it needs say which and how to make one", () => {
    expect(noColumnMessage("latitude")).toEqual({
      kind: "error",
      text: "No map was opened: the table has no latitude column. A column of numbers from −90 to 90 becomes one when “latitude” is chosen as its role.",
    });
    expect(noColumnMessage("longitude").text).toBe(
      "No map was opened: the table has no longitude column. A column of numbers from −180 to 180 becomes one when “longitude” is chosen as its role.",
    );
    expect(noColumnMessage("country").text).toBe(
      "No map of countries was opened: the table has no column of countries. A column of text that names countries by their ISO codes or names becomes one when “country” is chosen as its role.",
    );
  });
});
