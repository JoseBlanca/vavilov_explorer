import { describe, expect, test } from "vitest";

import { decodeRows } from "./decodeRows.ts";

// The bytes below are those the core writes in the tests of
// crates/vavilov-core/src/rows/tests.rs, where fertile is a category of
// yes or no and travels as its codes.

function buffer(bytes: readonly number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

/** A message of rows at `revision`, with these parts, each padded to 8 bytes. */
function rows(revision: number, ...parts: readonly (readonly [number, readonly number[]])[]) {
  const bytes = [3, 0, 0, 0, 0, 0, 0, 0, revision, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const [kind, payload] of parts) {
    const length = payload.length;
    bytes.push(kind, 0, 0, 0, length & 0xff, length >> 8, 0, 0, ...payload);
    while (bytes.length % 8 !== 0) {
      bytes.push(0);
    }
  }
  return buffer(bytes);
}

const UTF8 = (text: string): number[] => [...new TextEncoder().encode(text)];

/** The page part: loaded at 1, from row `first`, `count` rows. */
const page = (first: number, count: number): readonly [number, number[]] => [
  8,
  [1, 0, 0, 0, 0, 0, 0, 0, first, 0, 0, 0, count, 0, 0, 0],
];

/** The names part of p2 alone. */
const P2: readonly [number, number[]] = [9, [0, 0, 0, 0, 2, 0, 0, 0, ...UTF8("p2")]];

/** A values part of column 1 of `type` at revision 1, then `values`. */
const values = (type: number, rest: readonly number[]): readonly [number, number[]] => [
  10,
  [1, 0, 0, 0, type, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, ...rest],
];

function expectDefect(bytes: ArrayBuffer, what: RegExp): void {
  expect(() => decodeRows(bytes)).toThrow(/^Vavilov Explorer defect: /);
  expect(() => decodeRows(bytes)).toThrow(what);
}

describe("a page of rows", () => {
  test("gives the names and the values of each column, null for a missing one", () => {
    // prettier-ignore
    const bytes = buffer([
      3, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      8, 0, 0, 0, 16, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 3, 0, 0, 0,
      9, 0, 0, 0, 22, 0, 0, 0,
      0, 0, 0, 0, 2, 0, 0, 0,
      4, 0, 0, 0, 6, 0, 0, 0,
      0x70, 0x32, 0x70, 0x33, 0x70, 0x34, 0, 0,
      10, 0, 0, 0, 44, 0, 0, 0,
      6, 0, 0, 0, 2, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      0b001, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 4, 0, 0, 0,
      0x74, 0x61, 0x6c, 0x6c, 0, 0, 0, 0,
      10, 0, 0, 0, 48, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      0b001, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0x40,
      0, 0, 0, 0, 0, 0, 0x0a, 0x40,
      10, 0, 0, 0, 48, 0, 0, 0,
      4, 0, 0, 0, 1, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      0b010, 0, 0, 0, 0, 0, 0, 0,
      12, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      7, 0, 0, 0, 0, 0, 0, 0,
      10, 0, 0, 0, 22, 0, 0, 0,
      5, 0, 0, 0, 4, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0xff, 0xff, 1, 0, 0, 0,
      10, 0, 0, 0, 22, 0, 0, 0,
      2, 0, 0, 0, 4, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0xff, 0xff, 0, 0, 0, 0,
    ]);
    expect(decodeRows(bytes)).toEqual({
      revision: 1,
      loadedAt: 1,
      first: 1,
      count: 3,
      names: ["p2", "p3", "p4"],
      columns: [
        { id: 6, revision: 1, type: "text", values: [null, "", "tall"] },
        { id: 1, revision: 1, type: "float", values: [null, 2, 3.25] },
        { id: 4, revision: 1, type: "integer", values: [12n, null, 7n] },
        { id: 5, revision: 1, type: "categorical", codes: [0, null, 1] },
        { id: 2, revision: 1, type: "categorical", codes: [1, null, 0] },
      ],
    });
  });

  test("of nine rows reads two bytes of missing rows, names in UTF-8 and every i64", () => {
    // prettier-ignore
    const names = [
      0, 0, 0, 0, 7, 0, 0, 0, 9, 0, 0, 0, 11, 0, 0, 0, 13, 0, 0, 0,
      15, 0, 0, 0, 17, 0, 0, 0, 19, 0, 0, 0, 21, 0, 0, 0, 23, 0, 0, 0,
      0xc3, 0x91, 0x61, 0x6e, 0x64, 0xc3, 0xba,
      ...UTF8("p2p3p4p5p6p7p8p9"),
    ];
    // prettier-ignore
    const integers = [
      0b100, 0b1, 0, 0, 0, 0, 0, 0,
      0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      1, 0, 0, 0, 0, 0, 0x20, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
      2, 0, 0, 0, 0, 0, 0, 0,
      3, 0, 0, 0, 0, 0, 0, 0,
      4, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ];
    const decoded = decodeRows(rows(1, page(0, 9), [9, names], values(1, integers)));
    expect(decoded.names).toEqual(["Ñandú", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);
    expect(decoded.columns).toEqual([
      {
        id: 1,
        revision: 1,
        type: "integer",
        values: [-2n, 9_007_199_254_740_993n, null, 0n, 1n, 2n, 3n, 4n, null],
      },
    ]);
  });

  test("of no rows at the end of the table has its columns and no values", () => {
    const decoded = decodeRows(
      rows(1, page(4, 0), [9, [0, 0, 0, 0]], values(0, []), [
        10,
        [6, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ]),
    );
    expect(decoded).toEqual({
      revision: 1,
      loadedAt: 1,
      first: 4,
      count: 0,
      names: [],
      columns: [
        { id: 1, revision: 1, type: "float", values: [] },
        { id: 6, revision: 1, type: "text", values: [] },
      ],
    });
  });
});

describe("a page that does not decode is a defect", () => {
  test("a message of another kind", () => {
    const change = new Uint8Array(rows(1, page(1, 1), P2));
    change[0] = 1;
    expectDefect(change.buffer, /a message of kind 1 where rows were asked for/);
  });

  test("a message that does not start with its page part", () => {
    expectDefect(rows(1, P2, page(1, 1)), /does not start with its page part/);
  });

  test("a message without its names", () => {
    expectDefect(rows(1, page(1, 1)), /no names part after its page part/);
  });

  test("names of another number of rows than the page", () => {
    expectDefect(
      rows(1, page(1, 2), P2),
      /a text list of 10 bytes, shorter than the 12 of the offsets of 2 rows/,
    );
  });

  test("an offset that goes back", () => {
    expectDefect(
      rows(1, page(1, 2), [9, [0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, ...UTF8("p2")]]),
      /an offset 1 after 2 in a text list/,
    );
  });

  test("an offset past the texts", () => {
    expectDefect(
      rows(1, page(1, 1), [9, [0, 0, 0, 0, 3, 0, 0, 0, ...UTF8("p2")]]),
      /a text list whose texts end at 3 and has 2 bytes of them/,
    );
  });

  test("a first offset that is not 0", () => {
    expectDefect(
      rows(1, page(1, 1), [9, [1, 0, 0, 0, 2, 0, 0, 0, ...UTF8("p2")]]),
      /a text list whose first offset is 1/,
    );
  });

  test("a text that is not UTF-8", () => {
    expectDefect(
      rows(1, page(1, 1), [9, [0, 0, 0, 0, 2, 0, 0, 0, 0x70, 0xff]]),
      /a text list that is not UTF-8/,
    );
  });

  test("a missing number that holds a value", () => {
    // prettier-ignore
    const numbers = [0b1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xf0, 0x3f];
    expectDefect(
      rows(1, page(1, 1), P2, values(0, numbers)),
      /row 1 of column 1, missing, holds bytes that are not zero/,
    );
  });

  test("a number that is not finite", () => {
    // prettier-ignore
    const numbers = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xf0, 0x7f];
    expectDefect(rows(1, page(1, 1), P2, values(0, numbers)), /row 1 of column 1 holds Infinity/);
  });

  test("a missing text that is not empty", () => {
    // prettier-ignore
    const texts = [0b1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0x61];
    expectDefect(
      rows(1, page(1, 1), P2, values(2, texts)),
      /row 1 of column 1, missing, holds a text of 1 bytes/,
    );
  });

  test("a bit of a missing row beyond the page", () => {
    expectDefect(
      rows(1, page(1, 1), P2, values(1, [0b10, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])),
      /a bit set beyond the 1 rows of the page/,
    );
  });

  test("an unknown type", () => {
    expectDefect(rows(1, page(1, 1), P2, values(5, [])), /a values part of type 5/);
    // 3 was yes or no, which a page no longer carries.
    expectDefect(rows(1, page(1, 1), P2, values(3, [0, 0, 0, 0, 0, 0, 0, 0, 1])), /type 3/);
  });

  test("values of another length than the page asks for", () => {
    expectDefect(
      rows(1, page(1, 1), P2, values(4, [1, 0, 2, 0])),
      /a values part of 20 bytes, not 18, for type 4/,
    );
  });

  test("a part after the page that is not names or values", () => {
    expectDefect(
      rows(1, page(1, 1), P2, [7, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]),
      /a part of kind 7 in a page of rows/,
    );
  });
});
