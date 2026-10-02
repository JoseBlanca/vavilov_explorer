import { describe, expect, test } from "vitest";

import { isColumnId, isHoverSeq, isLevelCode, isRevision, isRowIndex } from "./ids.ts";
import type { ColumnId, HoverSeq, LevelCode, Revision, RowIndex } from "./ids.ts";
import type { Message, MessagePart } from "./message.ts";
import { createWindowState } from "./windowState.ts";
import type { Aspect } from "./windowState.ts";

function revision(value: number): Revision {
  if (!isRevision(value)) throw new Error(`not a revision: ${String(value)}`);
  return value;
}
function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error(`not a column: ${String(value)}`);
  return value;
}
function code(value: number): LevelCode {
  if (!isLevelCode(value)) throw new Error(`not a code: ${String(value)}`);
  return value;
}
function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error(`not a row: ${String(value)}`);
  return value;
}
function seq(value: number): HoverSeq {
  if (!isHoverSeq(value)) throw new Error(`not a sequence number: ${String(value)}`);
  return value;
}

const ORIGIN = column(2);
const CLUSTER = column(3);
const HEIGHT = column(1);

/** The parts of the plants of the core's tests, four rows, loaded at 1. */
function plantParts(loadedAt: number): MessagePart[] {
  return [
    { kind: "project", numRows: 4, loadedAt: revision(loadedAt) },
    { kind: "shape", shapeAt: revision(loadedAt) },
    { kind: "active", column: ORIGIN, selected: null },
    { kind: "selection", numRows: 4, bits: new Uint8Array([0]) },
    { kind: "undo", canUndo: false, canRedo: false },
    {
      kind: "columns",
      columns: [HEIGHT, ORIGIN, CLUSTER].map((id) => ({
        column: id,
        revision: revision(loadedAt),
      })),
    },
    {
      kind: "codes",
      column: ORIGIN,
      revision: revision(loadedAt),
      codes: new Uint16Array([0, 1, 0xffff, 0]),
    },
    {
      kind: "codes",
      column: CLUSTER,
      revision: revision(loadedAt),
      codes: new Uint16Array([0xffff, 2, 2, 0]),
    },
    { kind: "hover", seq: seq(1), row: null },
  ];
}

function snapshot(at: number, parts: MessagePart[] = plantParts(1)): Message {
  return { kind: "snapshot", revision: revision(at), sentAt: null, parts };
}

function change(at: number, ...parts: MessagePart[]): Message {
  return { kind: "change", revision: revision(at), sentAt: null, parts };
}

function hover(at: number, sequence: number, under: number | null): Message {
  return {
    kind: "hover",
    revision: revision(at),
    sentAt: null,
    parts: [{ kind: "hover", seq: seq(sequence), row: under === null ? null : row(under) }],
  };
}

/** The aspects whose listeners each message calls, in order. */
function recordAspects(state: ReturnType<typeof createWindowState>): Aspect[] {
  const called: Aspect[] = [];
  for (const aspect of [
    "table",
    "classification",
    "codes",
    "selection",
    "hover",
    "undoRedo",
  ] as const) {
    state.subscribe(aspect, () => {
      called.push(aspect);
    });
  }
  return called;
}

describe("a window's state made from a snapshot", () => {
  test("holds every part of it", () => {
    const state = createWindowState(snapshot(1));
    expect(state.revision()).toBe(1);
    expect(state.project()).toEqual({ kind: "open", numRows: 4, loadedAt: 1 });
    expect(state.active()).toEqual({ column: ORIGIN, selected: null });
    expect([...(state.codes(CLUSTER) ?? [])]).toEqual([0xffff, 2, 2, 0]);
    expect(state.codes(HEIGHT)).toBeNull();
    expect(state.columnRevision(HEIGHT)).toBe(1);
    expect(state.columnRevision(column(9))).toBeNull();
    expect([...(state.selection() ?? [])]).toEqual([0]);
    expect(state.hover()).toBeNull();
    expect(state.undoRedo()).toEqual({ canUndo: false, canRedo: false });
  });

  test("with no project, holds none", () => {
    const state = createWindowState(
      snapshot(0, [{ kind: "noProject" }, { kind: "hover", seq: seq(0), row: null }]),
    );
    expect(state.project()).toEqual({ kind: "noProject" });
    expect(state.selection()).toBeNull();
    expect(state.active()).toBeNull();
  });

  test("is refused from a message that is not a snapshot", () => {
    expect(() => createWindowState(change(1, ...plantParts(1)))).toThrow(/defect/);
  });
});

describe("applying a change", () => {
  test("one revision after the last applies it and calls the listeners of what it changed", () => {
    const state = createWindowState(snapshot(1));
    const called = recordAspects(state);
    state.apply(change(2, { kind: "selection", numRows: 4, bits: new Uint8Array([0b1010]) }));
    expect(state.revision()).toBe(2);
    expect([...(state.selection() ?? [])]).toEqual([0b1010]);
    expect(called).toEqual(["selection"]);
  });

  test("a lasso's change sets the codes, the column's revision and the undo", () => {
    const state = createWindowState(snapshot(1));
    const called = recordAspects(state);
    state.apply(
      change(
        2,
        {
          kind: "codes",
          column: ORIGIN,
          revision: revision(2),
          codes: new Uint16Array([0, 0, 0, 0]),
        },
        { kind: "columns", columns: [{ column: ORIGIN, revision: revision(2) }] },
        { kind: "undo", canUndo: true, canRedo: false },
      ),
    );
    expect([...(state.codes(ORIGIN) ?? [])]).toEqual([0, 0, 0, 0]);
    expect(state.columnRevision(ORIGIN)).toBe(2);
    expect(state.columnRevision(HEIGHT)).toBe(1);
    expect(state.undoRedo()).toEqual({ canUndo: true, canRedo: false });
    expect(called).toEqual(["table", "codes", "undoRedo"]);
  });

  test("a new active classification and population", () => {
    const state = createWindowState(snapshot(1));
    const called = recordAspects(state);
    state.apply(
      change(2, {
        kind: "active",
        column: CLUSTER,
        selected: { kind: "population", code: code(1) },
      }),
    );
    expect(state.active()).toEqual({ column: CLUSTER, selected: { kind: "population", code: 1 } });
    state.apply(change(3, { kind: "active", column: null, selected: null }));
    expect(state.active()).toBeNull();
    expect(called).toEqual(["classification", "classification"]);
  });

  test("at or before the current revision is dropped, since the copy holds it", () => {
    const state = createWindowState(snapshot(2));
    const called = recordAspects(state);
    state.apply(change(2, { kind: "selection", numRows: 4, bits: new Uint8Array([1]) }));
    state.apply(change(1, { kind: "selection", numRows: 4, bits: new Uint8Array([1]) }));
    expect(state.revision()).toBe(2);
    expect([...(state.selection() ?? [])]).toEqual([0]);
    expect(called).toEqual([]);
  });

  test("that skips a revision is a defect", () => {
    const state = createWindowState(snapshot(1));
    expect(() => {
      state.apply(change(3, { kind: "undo", canUndo: true, canRedo: false }));
    }).toThrow(/defect.*revision 3.*2/);
  });

  test("of a load replaces the whole state", () => {
    const state = createWindowState(snapshot(1));
    state.apply(change(2, { kind: "selection", numRows: 4, bits: new Uint8Array([0b1111]) }));
    const called = recordAspects(state);
    const nineRows: MessagePart[] = [
      { kind: "project", numRows: 9, loadedAt: revision(3) },
      { kind: "active", column: null, selected: null },
      { kind: "selection", numRows: 9, bits: new Uint8Array([0, 0]) },
      { kind: "undo", canUndo: false, canRedo: false },
      { kind: "columns", columns: [{ column: HEIGHT, revision: revision(3) }] },
      { kind: "hover", seq: seq(2), row: null },
    ];
    state.apply(change(3, ...nineRows));
    expect(state.project()).toEqual({ kind: "open", numRows: 9, loadedAt: 3 });
    expect(state.codes(ORIGIN)).toBeNull();
    expect(state.columnRevision(ORIGIN)).toBeNull();
    expect([...(state.selection() ?? [])]).toEqual([0, 0]);
    expect(called).toEqual(["table", "classification", "codes", "selection", "hover", "undoRedo"]);
  });

  test("whose parts do not fit the table is a defect", () => {
    const state = createWindowState(snapshot(1));
    expect(() => {
      state.apply(change(2, { kind: "selection", numRows: 9, bits: new Uint8Array([0, 0]) }));
    }).toThrow(/defect.*selection of 9 rows.*4/);
    expect(() => {
      state.apply(
        change(2, {
          kind: "codes",
          column: ORIGIN,
          revision: revision(2),
          codes: new Uint16Array([0]),
        }),
      );
    }).toThrow(/defect.*1 codes.*4/);
    expect(() => {
      state.apply(change(2, { kind: "active", column: HEIGHT, selected: null }));
    }).toThrow(/defect.*column 1/);
    expect(() => {
      state.apply(hover(1, 2, 4));
    }).toThrow(/defect.*row 4/);
  });

  test("that fails on a part leaves the copy as it was", () => {
    const state = createWindowState(snapshot(1));
    const called = recordAspects(state);
    expect(() => {
      state.apply(
        change(
          2,
          { kind: "selection", numRows: 4, bits: new Uint8Array([0b1111]) },
          { kind: "codes", column: ORIGIN, revision: revision(2), codes: new Uint16Array([0]) },
        ),
      );
    }).toThrow(/defect/);
    expect(state.revision()).toBe(1);
    expect([...(state.selection() ?? [])]).toEqual([0]);
    expect(called).toEqual([]);
  });

  test("with no project, a part about the table is a defect", () => {
    const state = createWindowState(
      snapshot(0, [{ kind: "noProject" }, { kind: "hover", seq: seq(0), row: null }]),
    );
    expect(() => {
      state.apply(change(1, { kind: "selection", numRows: 4, bits: new Uint8Array([0]) }));
    }).toThrow(/defect.*no project/);
  });

  test("a snapshot given to apply is a defect", () => {
    const state = createWindowState(snapshot(1));
    expect(() => {
      state.apply(snapshot(2));
    }).toThrow(/defect/);
  });
});

describe("applying a hover", () => {
  test("keeps the hover of the highest sequence number, whatever its revision", () => {
    const state = createWindowState(snapshot(1));
    const called = recordAspects(state);
    state.apply(hover(1, 2, 3));
    expect(state.hover()).toBe(3);
    // A hover older than the one the copy has, as one sent before the
    // snapshot would be.
    state.apply(hover(1, 1, 0));
    expect(state.hover()).toBe(3);
    // The same sequence number again, as a hover the snapshot already holds.
    state.apply(hover(1, 2, 0));
    expect(state.hover()).toBe(3);
    state.apply(change(2, { kind: "undo", canUndo: true, canRedo: false }));
    state.apply(hover(2, 3, null));
    expect(state.hover()).toBeNull();
    expect(state.revision()).toBe(2);
    expect(called).toEqual(["hover", "undoRedo", "hover"]);
  });
});

describe("a listener", () => {
  test("stops being called once unsubscribed", () => {
    const state = createWindowState(snapshot(1));
    let calls = 0;
    const unsubscribe = state.subscribe("hover", () => {
      calls += 1;
    });
    state.apply(hover(1, 2, 0));
    unsubscribe();
    state.apply(hover(1, 3, 1));
    expect(calls).toBe(1);
  });
});

describe("a change of a column's role", () => {
  test("moves the shape, so that the window asks for the description again", () => {
    const state = createWindowState(snapshot(1));
    expect(state.shapeAt()).toBe(1);
    const seen: Aspect[] = [];
    state.subscribe("table", () => seen.push("table"));
    state.apply(
      change(
        2,
        { kind: "shape", shapeAt: revision(2) },
        {
          kind: "columns",
          columns: [{ column: HEIGHT, revision: revision(2) }],
        },
      ),
    );
    expect(state.shapeAt()).toBe(2);
    expect(seen).toEqual(["table"]);
  });

  test("of a category to a number drops its codes, and of a number to a category brings them", () => {
    const state = createWindowState(snapshot(1));
    const seen: Aspect[] = [];
    state.subscribe("codes", () => seen.push("codes"));
    // cluster becomes a number: listed, with no codes beside it.
    state.apply(
      change(
        2,
        { kind: "shape", shapeAt: revision(2) },
        {
          kind: "columns",
          columns: [{ column: CLUSTER, revision: revision(2) }],
        },
      ),
    );
    expect(state.codes(CLUSTER)).toBeNull();
    expect(seen).toEqual(["codes"]);
    // height becomes a category: listed, with its codes.
    state.apply(
      change(
        3,
        { kind: "shape", shapeAt: revision(3) },
        {
          kind: "codes",
          column: HEIGHT,
          revision: revision(3),
          codes: new Uint16Array([1, 0, 0, 2]),
        },
        { kind: "columns", columns: [{ column: HEIGHT, revision: revision(3) }] },
      ),
    );
    expect([...(state.codes(HEIGHT) ?? [])]).toEqual([1, 0, 0, 2]);
    // origin keeps its codes through both.
    expect([...(state.codes(ORIGIN) ?? [])]).toEqual([0, 1, 0xffff, 0]);
  });

  test("with no project open has no shape", () => {
    const state = createWindowState(
      snapshot(0, [{ kind: "noProject" }, { kind: "hover", seq: seq(0), row: null }]),
    );
    expect(state.shapeAt()).toBeNull();
  });

  test("with no project open is a defect, and leaves the copy as it was", () => {
    const state = createWindowState(
      snapshot(0, [{ kind: "noProject" }, { kind: "hover", seq: seq(0), row: null }]),
    );
    expect(() => {
      state.apply(change(1, { kind: "shape", shapeAt: revision(1) }));
    }).toThrow("Vavilov Explorer defect: the shape of the table with no project open");
    expect(state.revision()).toBe(0);
    expect(state.shapeAt()).toBeNull();
  });
});
