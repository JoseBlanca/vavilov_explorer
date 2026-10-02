import { describe, expect, test } from "vitest";

import { decodeAction, isActionMessage } from "./decodeAction.ts";

// The bytes the core writes in crates/vavilov-core/src/action/tests.rs.
function message(code: number, zero = 0): ArrayBuffer {
  // prettier-ignore
  return new Uint8Array([
    4, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    12, 0, 0, 0, 8, 0, 0, 0,
    code, 0, zero, 0, 0, 0, 0, 0,
  ]).buffer;
}

describe("a message of an action", () => {
  test("gives the item of the menu by its code", () => {
    expect(isActionMessage(message(3))).toBe(true);
    expect(decodeAction(message(1))).toBe("importTable");
    expect(decodeAction(message(2))).toBe("exportCsv");
    expect(decodeAction(message(3))).toBe("exportXlsx");
  });

  test("with an unknown code, or a byte that should be zero, is a defect", () => {
    expect(() => decodeAction(message(4))).toThrow(/defect: an action of code 4/);
    expect(() => decodeAction(message(0))).toThrow(/defect: an action of code 0/);
    expect(() => decodeAction(message(1, 1))).toThrow(/defect: bytes 2 to 7 of an action part/);
  });

  test("is told apart from the others by its byte 0", () => {
    const change = new Uint8Array(message(1));
    change[0] = 1;
    expect(isActionMessage(change.buffer)).toBe(false);
  });
});
