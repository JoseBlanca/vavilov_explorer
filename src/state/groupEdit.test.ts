import { describe, expect, test } from "vitest";

import { NO_CODE, isLevelCode } from "./ids.ts";
import type { LevelCode } from "./ids.ts";
import {
  addedCount,
  deletedMessage,
  pressedMessage,
  releasedMessage,
  removedCount,
} from "./groupEdit.ts";

function code(value: number): LevelCode {
  if (!isLevelCode(value)) {
    throw new Error(`not a level code: ${String(value)}`);
  }
  return value;
}

/** Ten rows: Spain (0), Peru (1), unassigned, Spain, Peru, Peru, unassigned, Spain, Peru, Spain. */
const CODES = new Uint16Array([0, 1, NO_CODE, 0, 1, 1, NO_CODE, 0, 1, 0]);
/** Rows 0, 1, 2, 4 and 9 selected: Spain, Peru, unassigned, Peru, Spain. */
const SELECTION = new Uint8Array([0b0001_0111, 0b10]);

const words = (value: number): string => value.toLocaleString("en");

describe("the individuals + changes", () => {
  test("are the selected ones not in the group already", () => {
    expect(addedCount(SELECTION, CODES, { kind: "group", code: code(0) })).toBe(3);
    expect(addedCount(SELECTION, CODES, { kind: "group", code: code(1) })).toBe(3);
    expect(addedCount(SELECTION, CODES, { kind: "group", code: code(2) })).toBe(5);
  });

  test("with the unassigned selected are the selected ones in any group", () => {
    expect(addedCount(SELECTION, CODES, { kind: "unassigned" })).toBe(4);
  });

  test("are none with nothing selected", () => {
    expect(addedCount(new Uint8Array(2), CODES, { kind: "unassigned" })).toBe(0);
  });
});

describe("the individuals − leaves unassigned", () => {
  test("are the selected ones in the group, and no other", () => {
    expect(removedCount(SELECTION, CODES, [code(0)])).toBe(2);
    expect(removedCount(SELECTION, CODES, [code(1)])).toBe(2);
    expect(removedCount(SELECTION, CODES, [code(2)])).toBe(0);
  });
});

describe("the message after + or − is pressed", () => {
  const china = { kind: "group", code: code(2), name: "China" } as const;
  const unassigned = { kind: "unassigned" } as const;

  test("says how many selected individuals moved, how to stop, and how to undo", () => {
    expect(pressedMessage(1234, china, "add", words)).toEqual({
      kind: "information",
      text: "1,234 individuals added to China. Rows you select now go to China too, until you press + again or Escape; Edit > Undo takes back each change.",
    });
    expect(pressedMessage(1, china, "add", words).text).toMatch(/^1 individual added to China\. /);
    expect(pressedMessage(34, unassigned, "add", words)).toEqual({
      kind: "information",
      text: "34 individuals made unassigned. Rows you select are now made unassigned too, until you press + again or Escape; Edit > Undo takes back each change.",
    });
    expect(pressedMessage(12, china, "remove", words)).toEqual({
      kind: "information",
      text: "12 individuals removed from China. Rows you select now leave China too, if they are in it, until you press − again or Escape; Edit > Undo takes back each change.",
    });
  });

  test("with no individual moved says only how the button works", () => {
    expect(pressedMessage(0, china, "add", words)).toEqual({
      kind: "information",
      text: "Rows you select now go to China, until you press + again or Escape; Edit > Undo takes back each change.",
    });
    expect(pressedMessage(0, unassigned, "add", words)).toEqual({
      kind: "information",
      text: "Rows you select are now made unassigned, until you press + again or Escape; Edit > Undo takes back each change.",
    });
    expect(pressedMessage(0, china, "remove", words)).toEqual({
      kind: "information",
      text: "Rows you select now leave China, if they are in it, until you press − again or Escape; Edit > Undo takes back each change.",
    });
  });

  test("− on the unassigned individuals is a defect", () => {
    expect(() => pressedMessage(0, unassigned, "remove", words)).toThrow(/defect/);
  });
});

describe("the message after the button is released", () => {
  test("says the rows selected no longer move", () => {
    const china = { kind: "group", code: code(2), name: "China" } as const;
    expect(releasedMessage(china, "add", String)).toEqual({
      kind: "information",
      text: "Rows you select no longer go to China.",
    });
    expect(releasedMessage({ kind: "unassigned" }, "add", String)).toEqual({
      kind: "information",
      text: "Rows you select are no longer made unassigned.",
    });
    expect(releasedMessage(china, "remove", String)).toEqual({
      kind: "information",
      text: "Rows you select no longer leave China.",
    });
  });
});

describe("the message after a group is deleted", () => {
  test("says how many of its individuals are unassigned now, and how to undo", () => {
    expect(deletedMessage("China", 1_204, (value) => value.toLocaleString("en"))).toEqual({
      kind: "information",
      text: "The group China was deleted, and its 1,204 individuals are unassigned now. Edit > Undo brings it back.",
    });
    expect(deletedMessage("China", 1, String).text).toBe(
      "The group China was deleted, and its 1 individual is unassigned now. Edit > Undo brings it back.",
    );
  });

  test("of an empty group says only that it was deleted, and how to undo", () => {
    expect(deletedMessage("China", 0, String).text).toBe(
      "The group China, which had no individuals, was deleted. Edit > Undo brings it back.",
    );
  });
});
