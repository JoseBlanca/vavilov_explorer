import { describe, expect, test } from "vitest";

import { decodeMessage } from "./decodeMessage.ts";

// The bytes below are those the encoder of the core writes, in the tests of
// crates/vavilov-core/src/message/tests.rs and session/tests.rs.

function buffer(...bytes: readonly number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

/** A header of a change at revision 5 with no time. */
const CHANGE_AT_5 = [1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const HOVER_PART = [7, 0, 0, 0, 12, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0];

function parts(...partBytes: readonly number[]): ReturnType<typeof decodeMessage>["parts"] {
  return decodeMessage(buffer(...CHANGE_AT_5, ...partBytes)).parts;
}

function expectDefect(bytes: readonly number[], what: RegExp): void {
  expect(() => decodeMessage(buffer(...bytes))).toThrow(/^Vavilov Explorer defect: /);
  expect(() => decodeMessage(buffer(...bytes))).toThrow(what);
}

describe("the header", () => {
  test("gives the kind, the revision and the time", () => {
    const message = decodeMessage(
      buffer(1, 1, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xf8, 0x3f),
    );
    expect(message).toEqual({ kind: "change", revision: 5, sentAt: 1.5, parts: [] });
  });

  test("a message without a time gives null", () => {
    const message = decodeMessage(
      buffer(
        2,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        2,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        ...[0, 0, 0, 0, 0, 0, 0, 0],
        ...HOVER_PART,
      ),
    );
    expect(message.kind).toBe("hover");
    expect(message.revision).toBe(0x0102);
    expect(message.sentAt).toBeNull();
  });

  test("a snapshot with no project has the project part and the hover", () => {
    const message = decodeMessage(
      buffer(
        ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ...[1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ...[7, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0],
      ),
    );
    expect(message).toEqual({
      kind: "snapshot",
      revision: 0,
      sentAt: null,
      parts: [{ kind: "noProject" }, { kind: "hover", seq: 0, row: null }],
    });
  });
});

describe("the parts", () => {
  test("the project part gives the rows and the revision of the load", () => {
    expect(
      parts(
        ...[
          1, 0, 0, 0, 24, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0,
          0, 0,
        ],
      ),
    ).toEqual([{ kind: "project", numRows: 4, loadedAt: 3 }]);
  });

  test("the active part gives the column and the population, or null for none", () => {
    expect(parts(...[2, 0, 0, 0, 7, 0, 0, 0, 2, 0, 0, 0, 1, 0, 1, 0])).toEqual([
      { kind: "active", column: 2, selected: { kind: "population", code: 1 } },
    ]);
    expect(parts(...[2, 0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 255, 255, 2, 0])).toEqual([
      { kind: "active", column: 3, selected: { kind: "unassigned" } },
    ]);
    expect(parts(...[2, 0, 0, 0, 7, 0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0])).toEqual([
      { kind: "active", column: null, selected: null },
    ]);
    expect(parts(...[2, 0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 255, 255, 0, 0])).toEqual([
      { kind: "active", column: 3, selected: null },
    ]);
  });

  test("the selection part gives the rows and one bit per row", () => {
    const [selection] = parts(
      ...[3, 0, 0, 0, 10, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
    );
    expect(selection?.kind).toBe("selection");
    if (selection?.kind === "selection") {
      expect(selection.numRows).toBe(9);
      expect([...selection.bits]).toEqual([1, 1]);
    }
  });

  test("the codes part gives the column, its revision and a code per row", () => {
    const [codes] = parts(
      ...[4, 0, 0, 0, 24, 0, 0, 0],
      ...[2, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 255, 255, 2, 1],
    );
    expect(codes?.kind).toBe("codes");
    if (codes?.kind === "codes") {
      expect(codes.column).toBe(2);
      expect(codes.revision).toBe(7);
      expect([...codes.codes]).toEqual([0, 1, 0xffff, 0x0102]);
    }
  });

  test("the undo part gives whether there is something to undo and to redo", () => {
    expect(parts(...[5, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])).toEqual([
      { kind: "undo", canUndo: true, canRedo: false },
    ]);
  });

  test("the columns part gives each column with its revision", () => {
    expect(
      parts(
        ...[6, 0, 0, 0, 40, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
        ...[1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
        ...[2, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0],
      ),
    ).toEqual([
      {
        kind: "columns",
        columns: [
          { column: 1, revision: 3 },
          { column: 2, revision: 4 },
        ],
      },
    ]);
  });

  test("the hover part gives its sequence number and the row, or null", () => {
    expect(parts(...HOVER_PART)).toEqual([{ kind: "hover", seq: 9, row: 3 }]);
  });

  test("parts follow one another, each at a multiple of 8", () => {
    expect(
      parts(
        ...[5, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
        ...[7, 0, 0, 0, 12, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0],
        ...[2, 0, 0, 0, 7, 0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0],
      ),
    ).toEqual([
      { kind: "undo", canUndo: false, canRedo: true },
      { kind: "hover", seq: 1, row: null },
      { kind: "active", column: null, selected: null },
    ]);
  });

  test("a lasso's change, as the session sends it, gives its codes, columns and undo", () => {
    const message = decodeMessage(
      buffer(
        ...[1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ...[4, 0, 0, 0, 24, 0, 0, 0],
        ...[2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ...[6, 0, 0, 0, 24, 0, 0, 0],
        ...[1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
        ...[5, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      ),
    );
    expect(message.revision).toBe(3);
    expect(message.parts.map((part) => part.kind)).toEqual(["codes", "columns", "undo"]);
  });
});

describe("the boundaries", () => {
  test("a selection of 8 rows uses the whole of its last byte", () => {
    const [selection] = parts(
      ...[3, 0, 0, 0, 9, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0b1000_0000, 0, 0, 0, 0, 0, 0, 0],
    );
    expect(selection?.kind === "selection" ? [...selection.bits] : null).toEqual([0b1000_0000]);
  });

  test("a revision of 2^53 - 1 is read exactly", () => {
    const message = decodeMessage(
      buffer(
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        255,
        255,
        255,
        255,
        255,
        255,
        0x1f,
        0,
        ...CHANGE_AT_5.slice(16),
      ),
    );
    expect(message.revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("a table of no rows gives empty bits and codes", () => {
    expect(
      parts(
        ...[3, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ...[4, 0, 0, 0, 16, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      ).map((part) =>
        part.kind === "selection"
          ? part.bits.length
          : part.kind === "codes"
            ? part.codes.length
            : -1,
      ),
    ).toEqual([0, 0]);
  });

  test("a project of more rows than the core takes is a defect", () => {
    expectDefect(
      [
        ...CHANGE_AT_5,
        ...[1, 0, 0, 0, 24, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        ...[1, 0, 0, 0x10, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      ],
      /268435457 rows/,
    );
  });
});

describe("the snapshot after edits that the core's tests write", () => {
  // crates/vavilov-core/src/session/tests.rs, SNAPSHOT_AFTER_EDITS: the
  // plants loaded at 1, Spain selected at 2, a lasso of rows 1 and 2 into
  // Spain at 3, a hover on row 2, and cluster made active at 4.
  // prettier-ignore
  const SNAPSHOT_AFTER_EDITS = [
    0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, // snapshot at 4
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 24, 0, 0, 0, // no time; project part
    1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, // open, 4 rows
    1, 0, 0, 0, 0, 0, 0, 0, 11, 0, 0, 0, 8, 0, 0, 0, // loaded at 1; shape part
    1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 7, 0, 0, 0, // shape at 1; active part
    3, 0, 0, 0, 255, 255, 0, 0, 3, 0, 0, 0, 9, 0, 0, 0, // cluster, none; selection part
    4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 4 rows, none selected
    5, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // undo part: can undo
    6, 0, 0, 0, 120, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, // columns part: 7 columns
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // the names, at 1
    1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // height at 1
    2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, // origin at 3
    3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // cluster at 1
    4, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // seeds at 1
    5, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // fertile at 1
    6, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // note at 1
    4, 0, 0, 0, 24, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, // codes of origin
    3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // at 3: Spain four times
    4, 0, 0, 0, 24, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, // codes of cluster
    1, 0, 0, 0, 0, 0, 0, 0, 255, 255, 2, 0, 2, 0, 0, 0, // at 1: missing, C, C, A
    4, 0, 0, 0, 24, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, // codes of fertile
    1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 255, 255, 1, 0, // at 1: TRUE, FALSE, missing, TRUE
    7, 0, 0, 0, 12, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, // hover part, sequence 2
    2, 0, 0, 0, 0, 0, 0, 0, // row 2
  ];

  test("decodes to the state the core held", () => {
    const message = decodeMessage(buffer(...SNAPSHOT_AFTER_EDITS));
    const summary = message.parts.map((part) => {
      switch (part.kind) {
        case "codes":
          return {
            kind: part.kind,
            column: part.column,
            revision: part.revision,
            codes: [...part.codes],
          };
        case "selection":
          return { kind: part.kind, numRows: part.numRows, bits: [...part.bits] };
        case "noProject":
        case "project":
        case "active":
        case "undo":
        case "columns":
        case "hover":
        case "shape":
          return part;
      }
    });
    expect(message.kind).toBe("snapshot");
    expect(message.revision).toBe(4);
    expect(summary).toEqual([
      { kind: "project", numRows: 4, loadedAt: 1 },
      { kind: "shape", shapeAt: 1 },
      { kind: "active", column: 3, selected: null },
      { kind: "selection", numRows: 4, bits: [0] },
      { kind: "undo", canUndo: true, canRedo: false },
      {
        kind: "columns",
        columns: [
          { column: 0, revision: 1 },
          { column: 1, revision: 1 },
          { column: 2, revision: 3 },
          { column: 3, revision: 1 },
          { column: 4, revision: 1 },
          { column: 5, revision: 1 },
          { column: 6, revision: 1 },
        ],
      },
      { kind: "codes", column: 2, revision: 3, codes: [0, 0, 0, 0] },
      { kind: "codes", column: 3, revision: 1, codes: [0xffff, 2, 2, 0] },
      { kind: "codes", column: 5, revision: 1, codes: [1, 0, 0xffff, 1] },
      { kind: "hover", seq: 2, row: 2 },
    ]);
  });
});

describe("a message that does not decode is a defect", () => {
  test("shorter than its header, or not a multiple of 8 bytes", () => {
    expectDefect([1, 0, 0, 0, 0, 0, 0, 0], /24/);
    expectDefect([...CHANGE_AT_5, 0, 0, 0, 0], /multiple of 8/);
  });

  test("an unknown kind of message or of part", () => {
    expectDefect([3, ...CHANGE_AT_5.slice(1)], /kind of message 3/);
    expectDefect([...CHANGE_AT_5, 8, 0, 0, 0, 0, 0, 0, 0], /kind of part 8/);
    expectDefect([...CHANGE_AT_5, 12, 0, 0, 0, 0, 0, 0, 0], /kind of part 12/);
  });

  test("a byte that should be zero", () => {
    expectDefect([1, 2, ...CHANGE_AT_5.slice(2)], /flags/);
    expectDefect([1, 0, 0, 0, 0, 0, 0, 1, ...CHANGE_AT_5.slice(8)], /zero/);
    expectDefect([...CHANGE_AT_5.slice(0, 23), 0x3f], /time/);
    expectDefect([...CHANGE_AT_5, 5, 0, 1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], /zero/);
    expectDefect([...CHANGE_AT_5, 5, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], /padding/);
  });

  test("a part longer than the message", () => {
    expectDefect([...CHANGE_AT_5, 5, 0, 0, 0, 9, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], /beyond/);
  });

  test("a part of another length than its kind has", () => {
    expectDefect([...CHANGE_AT_5, 5, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], /undo/);
    expectDefect(
      [...CHANGE_AT_5, 3, 0, 0, 0, 10, 0, 0, 0, 17, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
      /selection/,
    );
  });

  test("a value out of its range", () => {
    expectDefect([...CHANGE_AT_5, 5, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0], /undo/);
    // Row 9 of a selection of 9 rows: a bit beyond the last row.
    expectDefect(
      [...CHANGE_AT_5, 3, 0, 0, 0, 10, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
      /beyond the last row/,
    );
    // A revision of 2^53, past what a number holds exactly.
    expectDefect(
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x20, 0, ...CHANGE_AT_5.slice(16)],
      /2\^53/,
    );
    // A codes part for the column that means no column.
    expectDefect(
      [
        ...CHANGE_AT_5,
        ...[4, 0, 0, 0, 16, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      ],
      /column/,
    );
  });

  test("a hover message without exactly one hover part", () => {
    expectDefect([2, ...CHANGE_AT_5.slice(1)], /hover/);
    expectDefect([2, ...CHANGE_AT_5.slice(1), ...HOVER_PART, ...HOVER_PART], /hover/);
  });

  test("a snapshot that does not start with the project part", () => {
    expectDefect([0, ...CHANGE_AT_5.slice(1), ...HOVER_PART], /snapshot/);
  });
});
