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
    expect(noNumbersMessage("scatter2d").text).toBe(
      "No 2D scatter was opened: the table has no column of numbers. A column of numbers shown as a category becomes one when “number” is chosen as its role.",
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

describe("the words of a plot past the limits", () => {
  test("say the window holds 6 at most, and how to open another", () => {
    expect(
      widgetRefusalMessage(
        "histogram",
        { kind: "tooManyTiles", label: "plots-1", most: 6 },
        nameOf,
      ),
    ).toEqual({
      kind: "error",
      text: "No histogram was opened: the Plots window holds 6 plots at most. Close one to open another.",
    });
    expect(
      widgetRefusalMessage("map", { kind: "tooManyTiles", label: "maps-2", most: 6 }, nameOf).text,
    ).toBe("No map was opened: the Maps window holds 6 maps at most. Close one to open another.");
    expect(
      widgetRefusalMessage("scatter2d", { kind: "tooManyTiles", label: "plots-1", most: 6 }, nameOf)
        .text,
    ).toBe(
      "No 2D scatter was opened: the Plots window holds 6 plots at most. Close one to open another.",
    );
    expect(
      widgetRefusalMessage("countryMap", { kind: "tooManyTiles", label: "maps-2", most: 6 }, nameOf)
        .text,
    ).toBe(
      "No map of countries was opened: the Maps window holds 6 maps at most. Close one to open another.",
    );
  });

  test("say 16 3D scatters and maps are open, and how to open another", () => {
    expect(
      widgetRefusalMessage("scatter3d", { kind: "tooManyWebGlViews", most: 16 }, nameOf),
    ).toEqual({
      kind: "error",
      text: "No 3D scatter was opened: 16 3D scatters and maps are open, as many as the graphics card is sure to draw at once. Close one to open another.",
    });
    expect(widgetRefusalMessage("map", { kind: "tooManyWebGlViews", most: 16 }, nameOf).text).toBe(
      "No map was opened: 16 3D scatters and maps are open, as many as the graphics card is sure to draw at once. Close one to open another.",
    );
  });
});

describe("the words of a plot added to a window that did not come to the front", () => {
  test("say it was added, as a warning, without the system's message", () => {
    expect(
      widgetRefusalMessage(
        "histogram",
        { kind: "windowNotRaised", label: "plots-1", message: "no focus" },
        nameOf,
      ),
    ).toEqual({
      kind: "warning",
      text: "The histogram was added to the Plots window, which could not be brought to the front.",
    });
    expect(
      widgetRefusalMessage(
        "countryMap",
        { kind: "windowNotRaised", label: "maps-1", message: "no focus" },
        nameOf,
      ).text,
    ).toBe(
      "The map of countries was added to the Maps window, which could not be brought to the front.",
    );
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
