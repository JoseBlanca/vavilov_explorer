import { describe, expect, test } from "vitest";

import { isColumnId } from "./ids.ts";
import type { ColumnId } from "./ids.ts";
import { noNumbersMessage, widgetRefusalMessage } from "./widgetMessages.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}

const NAMES = new Map([[2, "PC1"]]);
const nameOf = (id: number): string | null => NAMES.get(id) ?? null;

describe("the words of a 3D scatter that was not opened", () => {
  test("name the column that is no longer of numbers", () => {
    expect(widgetRefusalMessage({ kind: "notNumber", column: column(2) }, nameOf)).toEqual({
      kind: "error",
      text: "No 3D scatter was opened: “PC1” is no longer a column of numbers.",
    });
    expect(widgetRefusalMessage({ kind: "notNumber", column: column(9) }, nameOf).text).toBe(
      "No 3D scatter was opened: one of its columns is no longer a column of numbers.",
    );
  });

  test("say the system could not open the window, without its technical message", () => {
    const message = widgetRefusalMessage(
      { kind: "windowFailed", label: "scatter3d-1", message: "NSWindow failed" },
      nameOf,
    );
    expect(message.kind).toBe("error");
    expect(message.text).not.toContain("NSWindow");
    expect(message.text).not.toContain("scatter3d-1");
  });

  test("with no column of numbers say how to make one", () => {
    expect(noNumbersMessage().text).toContain("“number” is chosen as its role");
  });
});
