import { describe, expect, test } from "vitest";

import { isColumnId, isRowIndex } from "./ids.ts";
import type { ColumnId, RowIndex } from "./ids.ts";
import { refusalMessage } from "./refusalMessage.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}

function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error("not a row");
  return value;
}

const NAMES = new Map([
  [3, "lat"],
  [4, "origin"],
]);
const nameOf = (id: ColumnId): string | null => NAMES.get(id) ?? null;
const ORIGIN = column(4);

describe("the words of a command another window got ahead of", () => {
  test("say why a lasso was not applied, and to draw it again", () => {
    const lasso = { kind: "applyLasso" } as const;
    expect(refusalMessage(lasso, { kind: "noGroupSelected" }, nameOf)).toEqual({
      kind: "warning",
      text: "The lasso was not applied: no group is selected. Select a group, press + or −, and draw it again.",
    });
    expect(refusalMessage(lasso, { kind: "notSelected" }, nameOf)?.text).toBe(
      "The lasso was not applied: the groups selected changed in another window. Draw it again.",
    );
    expect(
      refusalMessage(lasso, { kind: "notActiveClassification", column: ORIGIN }, nameOf)?.text,
    ).toBe(
      "The lasso was not applied: the classification changed in another window. Draw it again.",
    );
  });

  test("say why + or − was not pressed or released", () => {
    expect(
      refusalMessage({ kind: "pressButton", mode: "add" }, { kind: "noGroupSelected" }, nameOf)
        ?.text,
    ).toBe("+ was not pressed: no group is selected. Select a group first.");
    expect(
      refusalMessage({ kind: "pressButton", mode: "remove" }, { kind: "noGroupSelected" }, nameOf)
        ?.text,
    ).toBe("− was not pressed: no group is selected. Select a group first.");
    const changed =
      "The groups selected changed in another window. Press + or − again if you still want it.";
    expect(
      refusalMessage({ kind: "pressButton", mode: "add" }, { kind: "notSelected" }, nameOf)?.text,
    ).toBe(changed);
    expect(
      refusalMessage(
        { kind: "releaseButton" },
        { kind: "notActiveClassification", column: ORIGIN },
        nameOf,
      )?.text,
    ).toBe(changed);
  });

  test("say why a group was not selected or deleted", () => {
    const changed = { kind: "notActiveClassification", column: ORIGIN } as const;
    expect(refusalMessage({ kind: "selectGroups" }, changed, nameOf)?.text).toBe(
      "The group was not selected: the classification changed in another window.",
    );
    expect(refusalMessage({ kind: "deleteGroup" }, changed, nameOf)?.text).toBe(
      "The group was not deleted: the classification changed in another window.",
    );
  });

  test("name the column that is no longer a category or no longer fits its role", () => {
    expect(
      refusalMessage(
        { kind: "chooseClassification", column: ORIGIN },
        { kind: "notCategory", column: ORIGIN },
        nameOf,
      )?.text,
    ).toBe("“origin” was not made the classification: it is no longer a category.");
    const lat = column(3);
    expect(
      refusalMessage(
        { kind: "setRole", column: lat, role: "latitude" },
        { kind: "valueNotFor", column: lat, role: "latitude", row: row(12) },
        nameOf,
      )?.text,
    ).toBe("“lat” was not made a latitude column: one of its values no longer fits.");
    expect(
      refusalMessage(
        { kind: "setRole", column: lat, role: "number" },
        { kind: "roleNotPossible", column: lat, storage: "text", role: "number" },
        nameOf,
      )?.text,
    ).toBe("“lat” was not made a column of numbers: one of its values no longer fits.");
  });

  test("say there is nothing to undo or to redo", () => {
    expect(refusalMessage({ kind: "undo" }, { kind: "nothingToUndo" }, nameOf)?.text).toBe(
      "There is nothing to undo.",
    );
    expect(refusalMessage({ kind: "redo" }, { kind: "nothingToRedo" }, nameOf)?.text).toBe(
      "There is nothing to redo.",
    );
  });

  test("are none for a refusal only a defect of the app could cause", () => {
    expect(
      refusalMessage(
        { kind: "applyLasso" },
        { kind: "rowSetLength", numRows: 6, numBytes: 2 },
        nameOf,
      ),
    ).toBeNull();
    expect(refusalMessage({ kind: "undo" }, { kind: "nothingToRedo" }, nameOf)).toBeNull();
    expect(refusalMessage({ kind: "selectGroups" }, { kind: "notSelected" }, nameOf)).toBeNull();
  });
});
