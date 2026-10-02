import { describe, expect, test } from "vitest";

import { isColumnId, isLevelCode, isRowIndex } from "../state/ids.ts";
import type { ColumnId, LevelCode, RowIndex } from "../state/ids.ts";
import { connect } from "./connection.ts";
import type { Transport } from "./transport.ts";

function buffer(...bytes: readonly number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function header(kind: number, revision: number): number[] {
  return [kind, 0, 0, 0, 0, 0, 0, 0, revision, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * The snapshot of a project of four rows loaded at 1: `origin`, column 2,
 * active, with the codes 0, 1, missing, 0; no selection; nothing to undo;
 * hover sequence number 1 and no hover.
 */
const SNAPSHOT = buffer(
  ...header(0, 1),
  ...[
    1, 0, 0, 0, 24, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
  ],
  ...[2, 0, 0, 0, 6, 0, 0, 0, 2, 0, 0, 0, 255, 255, 0, 0],
  ...[3, 0, 0, 0, 9, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ...[5, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ...[
    6, 0, 0, 0, 24, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
  ],
  ...[
    4, 0, 0, 0, 24, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 255, 255,
    0, 0,
  ],
  ...[7, 0, 0, 0, 12, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0],
);

/** A change of the selection at `revision`, to the rows of `bits`. */
function selectionAt(revision: number, bits: number): ArrayBuffer {
  return buffer(
    ...header(1, revision),
    ...[3, 0, 0, 0, 9, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, bits, 0, 0, 0, 0, 0, 0, 0],
  );
}

interface Call {
  readonly command: string;
  readonly args: unknown;
  readonly headers: Readonly<Record<string, string>> | undefined;
}

/**
 * A transport that answers the subscribe with `SNAPSHOT`, after delivering
 * `early` on the channel, and every other command with `answer`.
 */
function fakeTransport(
  options: { early?: readonly unknown[]; answer?: () => Promise<unknown> } = {},
): { transport: Transport; calls: Call[]; deliver: (message: unknown) => void } {
  const calls: Call[] = [];
  let onMessage: ((message: unknown) => void) | null = null;
  const deliver = (message: unknown): void => {
    if (onMessage === null) {
      throw new Error("no channel yet");
    }
    onMessage(message);
  };
  const transport: Transport = {
    invoke: async (command, args, headers) => {
      calls.push({ command, args, headers });
      if (command === "subscribe") {
        for (const message of options.early ?? []) {
          deliver(message);
        }
        return SNAPSHOT;
      }
      return (options.answer ?? (() => Promise.resolve(null)))();
    },
    channel: (listener) => {
      onMessage = listener;
      return "the channel";
    },
    now: () => 1_727_865_600_000.5,
  };
  return { transport, calls, deliver };
}

/** A command refused as Tauri refuses one: with the object the backend serialised. */
function refusedWith(value: unknown): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tauri rejects a refused command with the backend's error object, not an Error
  return Promise.reject(value);
}

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}
function code(value: number): LevelCode {
  if (!isLevelCode(value)) throw new Error("not a code");
  return value;
}
function row(value: number): RowIndex {
  if (!isRowIndex(value)) throw new Error("not a row");
  return value;
}

describe("connecting", () => {
  test("subscribes with the channel and builds the state from the snapshot", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport);
    expect(calls).toEqual([
      { command: "subscribe", args: { onChange: "the channel" }, headers: undefined },
    ]);
    expect(connection.state.revision()).toBe(1);
    expect(connection.state.active()).toEqual({ column: 2, selected: null });
    expect([...(connection.state.codes(column(2)) ?? [])]).toEqual([0, 1, 0xffff, 0]);
  });

  test("applies what the channel delivered before the snapshot, when it is newer", async () => {
    const { transport } = fakeTransport({
      early: [selectionAt(1, 0b0001), selectionAt(2, 0b0110)],
    });
    const connection = await connect(transport);
    expect(connection.state.revision()).toBe(2);
    expect([...(connection.state.selection() ?? [])]).toEqual([0b0110]);
  });

  test("applies every later message of the channel", async () => {
    const { transport, deliver } = fakeTransport();
    const connection = await connect(transport);
    deliver(selectionAt(2, 0b1000));
    expect([...(connection.state.selection() ?? [])]).toEqual([0b1000]);
  });

  test("a channel message that is not bytes is a defect", async () => {
    const { transport, deliver } = fakeTransport();
    await connect(transport);
    expect(() => {
      deliver("text");
    }).toThrow(/^Vavilov Explorer defect: .*channel/);
  });

  test("a refused subscribe is a defect", async () => {
    const refused: Transport = {
      ...fakeTransport().transport,
      invoke: () => refusedWith({ kind: "unknownWindow", label: "scatter3d-1" }),
    };
    await expect(connect(refused)).rejects.toThrow(/defect.*unknownWindow/);
  });
});

describe("a command", () => {
  test("carries the revision of the window's copy and the window's time", async () => {
    const { transport, calls, deliver } = fakeTransport();
    const connection = await connect(transport);
    deliver(selectionAt(2, 0));
    expect(await connection.setHover(row(3))).toEqual({ ok: true, value: null });
    await connection.selectPopulation(column(2), code(0));
    await connection.undo();
    expect(calls.slice(1)).toEqual([
      {
        command: "set_hover",
        args: { row: 3, basedOn: 2, sentAt: 1_727_865_600_000.5 },
        headers: undefined,
      },
      {
        command: "select_population",
        args: { column: 2, population: 0, basedOn: 2, sentAt: 1_727_865_600_000.5 },
        headers: undefined,
      },
      { command: "undo", args: { basedOn: 2, sentAt: 1_727_865_600_000.5 }, headers: undefined },
    ]);
  });

  test("with rows sends them as raw bytes, and the rest in headers", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport);
    const bits = new Uint8Array([0b0110]);
    await connection.assignRows(column(2), code(0), bits);
    await connection.setSelection(bits);
    expect(calls.slice(1)).toEqual([
      {
        command: "assign_rows",
        args: bits,
        headers: { column: "2", population: "0", "based-on": "1", "sent-at": "1727865600000.5" },
      },
      {
        command: "set_selection",
        args: bits,
        headers: { "based-on": "1", "sent-at": "1727865600000.5" },
      },
    ]);
  });

  test("refused gives the refusal as a value", async () => {
    const { transport } = fakeTransport({
      answer: () => refusedWith({ kind: "notSelectedPopulation", code: 0 }),
    });
    const connection = await connect(transport);
    expect(await connection.assignRows(column(2), code(0), new Uint8Array([1]))).toEqual({
      ok: false,
      error: { kind: "notSelectedPopulation", code: 0 },
    });
  });

  test("refused as a defect, or failing with what is not a refusal, throws a defect", async () => {
    const asDefect = fakeTransport({
      answer: () =>
        refusedWith({ kind: "defect", what: "the revision would pass 9007199254740991" }),
    });
    const connection = await connect(asDefect.transport);
    await expect(connection.redo()).rejects.toThrow(/^Vavilov Explorer defect: .*would pass/);

    const garbled = fakeTransport({
      answer: () => refusedWith({ kind: "noProject", extra: 1 }),
    });
    const other = await connect(garbled.transport);
    await expect(other.undo()).rejects.toThrow(/^Vavilov Explorer defect: .*undo/);
  });
});
