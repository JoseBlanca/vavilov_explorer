import { afterEach, describe, expect, test } from "vitest";

import { isColumnId, isLevelCode, isPosition, isRowIndex } from "../state/ids.ts";
import type { ColumnId, LevelCode, Position, RowIndex } from "../state/ids.ts";
import { connect } from "./connection.ts";
import { tauriTransport } from "./transport.ts";
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
 * no filter, every row shown since 1; hover sequence number 1 and no hover.
 */
const SNAPSHOT = buffer(
  ...header(0, 1),
  ...[
    1, 0, 0, 0, 24, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
  ],
  ...[2, 0, 0, 0, 8, 0, 0, 0, 2, 0, 0, 0, 255, 255, 0, 0],
  ...[3, 0, 0, 0, 9, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ...[5, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ...[13, 0, 0, 0, 32, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 255, 255, 255, 255],
  ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
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

function position(value: number): Position {
  if (!isPosition(value)) throw new Error("not a position");
  return value;
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

/** The handler of a test in which no channel message should fail. */
function failOnDefect(error: Error): void {
  throw new Error(`an unexpected defect: ${error.message}`);
}

describe("connecting", () => {
  test("subscribes with the channel and builds the state from the snapshot", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    expect(calls).toEqual([
      { command: "subscribe", args: { onChange: "the channel" }, headers: undefined },
    ]);
    expect(connection.state.revision()).toBe(1);
    expect(connection.state.active()).toEqual({ column: 2, selected: null, mode: null });
    expect([...(connection.state.codes(column(2)) ?? [])]).toEqual([0, 1, 0xffff, 0]);
  });

  test("applies what the channel delivered before the snapshot, in order, when it is newer", async () => {
    const { transport } = fakeTransport({
      early: [selectionAt(1, 0b0001), selectionAt(2, 0b0110), selectionAt(3, 0b1001)],
    });
    const connection = await connect(transport, failOnDefect);
    expect(connection.state.revision()).toBe(3);
    expect([...(connection.state.selection() ?? [])]).toEqual([0b1001]);
  });

  test("applies every later message of the channel", async () => {
    const { transport, deliver } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    deliver(selectionAt(2, 0b1000));
    expect([...(connection.state.selection() ?? [])]).toEqual([0b1000]);
  });

  test("a defect in a channel message goes to the handler, and the channel is then ignored", async () => {
    const { transport, deliver } = fakeTransport();
    const defects: string[] = [];
    const connection = await connect(transport, (error) => {
      defects.push(error.message);
    });
    deliver("text");
    deliver(selectionAt(2, 0b1000));
    expect(defects).toEqual([
      'Vavilov Explorer defect: a channel message that is not bytes, as after Tauri\'s fallback to postMessage: "text"',
    ]);
    expect(connection.state.revision()).toBe(1);
  });

  test("after a defect on the channel, a command is a defect and is not sent", async () => {
    const { transport, calls, deliver } = fakeTransport();
    const connection = await connect(transport, () => undefined);
    deliver("text");
    await expect(connection.setSelection(new Uint8Array([0b1000]))).rejects.toThrow(
      "Vavilov Explorer defect: the command set_selection, from a copy of the state that met a defect",
    );
    await expect(connection.setHover(null)).rejects.toThrow(/set_hover/);
    expect(calls.map((call) => call.command)).toEqual(["subscribe"]);
  });

  test("a skipped revision on the channel goes to the handler", async () => {
    const { transport, deliver } = fakeTransport();
    const defects: string[] = [];
    await connect(transport, (error) => {
      defects.push(error.message);
    });
    deliver(selectionAt(3, 0b1000));
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatch(/revision 2 is missing/);
  });

  test("a refused subscribe is a defect", async () => {
    const refused: Transport = {
      ...fakeTransport().transport,
      invoke: () => refusedWith({ kind: "unknownWindow", label: "scatter3d-1" }),
    };
    await expect(connect(refused, failOnDefect)).rejects.toThrow(/defect.*unknownWindow/);
  });
});

describe("a command", () => {
  test("carries the revision of the window's copy and the window's time", async () => {
    const { transport, calls, deliver } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    deliver(selectionAt(2, 0));
    expect(await connection.setHover(row(3))).toEqual({ ok: true, value: "applied" });
    await connection.selectPopulation(column(2), { kind: "population", code: code(0) });
    await connection.selectPopulation(column(2), { kind: "unassigned" });
    await connection.selectPopulation(column(2), null);
    await connection.setActiveClassification(null);
    await connection.undo();
    await connection.redo();
    expect(calls.slice(1)).toEqual([
      {
        command: "set_hover",
        args: { row: 3, basedOn: 2, sentAt: 1_727_865_600_000.5 },
        headers: undefined,
      },
      {
        command: "select_population",
        args: { column: 2, selected: { population: 0 }, basedOn: 2, sentAt: 1_727_865_600_000.5 },
        headers: undefined,
      },
      {
        command: "select_population",
        args: { column: 2, selected: "unassigned", basedOn: 2, sentAt: 1_727_865_600_000.5 },
        headers: undefined,
      },
      {
        command: "select_population",
        args: { column: 2, selected: null, basedOn: 2, sentAt: 1_727_865_600_000.5 },
        headers: undefined,
      },
      {
        command: "set_active_classification",
        args: { column: null, basedOn: 2, sentAt: 1_727_865_600_000.5 },
        headers: undefined,
      },
      { command: "undo", args: { basedOn: 2, sentAt: 1_727_865_600_000.5 }, headers: undefined },
      { command: "redo", args: { basedOn: 2, sentAt: 1_727_865_600_000.5 }, headers: undefined },
    ]);
  });

  test("with rows sends them as raw bytes, and the rest in headers", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    const bits = new Uint8Array([0b0110]);
    await connection.assignRows(column(2), { kind: "population", code: code(0) }, bits);
    await connection.assignRows(column(2), { kind: "unassigned" }, bits);
    await connection.unassignRows(column(2), code(1), bits);
    await connection.setSelection(bits);
    expect(calls.slice(1)).toEqual([
      {
        command: "assign_rows",
        args: bits,
        headers: { column: "2", target: "0", "based-on": "1", "sent-at": "1727865600000.5" },
      },
      {
        command: "assign_rows",
        args: bits,
        headers: {
          column: "2",
          target: "unassigned",
          "based-on": "1",
          "sent-at": "1727865600000.5",
        },
      },
      {
        command: "unassign_rows",
        args: bits,
        headers: { column: "2", population: "1", "based-on": "1", "sent-at": "1727865600000.5" },
      },
      {
        command: "set_selection",
        args: bits,
        headers: { "based-on": "1", "sent-at": "1727865600000.5" },
      },
    ]);
  });

  test("of cells sends the rows as raw bytes, and the text and the decimal mark percent-encoded", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    const bits = new Uint8Array([0b0110]);
    await connection.setCells(column(0), bits, "Ñandú 1,5%", ",");
    expect(calls.slice(1)).toEqual([
      {
        command: "set_cells",
        args: bits,
        headers: {
          column: "0",
          text: "%C3%91and%C3%BA%201%2C5%25",
          "decimal-mark": "%2C",
          "based-on": "1",
          "sent-at": "1727865600000.5",
        },
      },
    ]);
  });

  test("adding a population sends its name and the decimal mark as JSON", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    await connection.addPopulation(column(2), " China", ",");
    expect(calls.slice(1)).toEqual([
      {
        command: "add_population",
        args: {
          column: 2,
          name: " China",
          decimalMark: ",",
          basedOn: 1,
          sentAt: 1_727_865_600_000.5,
        },
        headers: undefined,
      },
    ]);
  });

  test("pressing + or − sends what is selected and the button as JSON", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    await connection.setEditMode(column(2), { kind: "population", code: code(1) }, "remove");
    await connection.setEditMode(column(2), { kind: "unassigned" }, null);
    expect(calls.slice(1).map((call) => [call.command, call.args])).toEqual([
      [
        "set_edit_mode",
        {
          column: 2,
          target: { population: 1 },
          mode: "remove",
          basedOn: 1,
          sentAt: 1_727_865_600_000.5,
        },
      ],
      [
        "set_edit_mode",
        { column: 2, target: "unassigned", mode: null, basedOn: 1, sentAt: 1_727_865_600_000.5 },
      ],
    ]);
  });

  test("refused for a population's name gives the refusal with its reason", async () => {
    const refusal = {
      kind: "populationRefused",
      columnName: "origin",
      text: "Peru",
      refusal: { kind: "taken", code: 1 },
    };
    const { transport } = fakeTransport({ answer: () => refusedWith(refusal) });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.addPopulation(column(2), "Peru", ".")).toEqual({
      ok: false,
      error: refusal,
    });
  });

  test("refused gives the refusal as a value", async () => {
    const { transport } = fakeTransport({
      answer: () => refusedWith({ kind: "notSelected", target: { population: 0 } }),
    });
    const connection = await connect(transport, failOnDefect);
    expect(
      await connection.assignRows(
        column(2),
        { kind: "population", code: code(0) },
        new Uint8Array([1]),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "notSelected", target: { population: 0 } },
    });
  });

  test("refused as a defect, or failing with what is not a refusal, throws a defect", async () => {
    const asDefect = fakeTransport({
      answer: () =>
        refusedWith({ kind: "defect", what: "the revision would pass 9007199254740991" }),
    });
    const connection = await connect(asDefect.transport, failOnDefect);
    await expect(connection.redo()).rejects.toThrow(/^Vavilov Explorer defect: .*would pass/);

    const garbled = fakeTransport({
      answer: () => refusedWith({ kind: "noProject", extra: 1 }),
    });
    const other = await connect(garbled.transport, failOnDefect);
    await expect(other.undo()).rejects.toThrow(/^Vavilov Explorer defect: .*undo/);
  });
});

describe("a command made before the current table was loaded", () => {
  test("is answered as stale, which no caller can show as a refusal", async () => {
    const { transport } = fakeTransport({
      answer: () => refusedWith({ kind: "madeBeforeLoad", basedOn: 1, loadedAt: 2 }),
    });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.undo()).toEqual({ ok: true, value: "stale" });
  });
});

describe("a command made before the populations it names changed", () => {
  test("is answered as stale, which no caller can show as a refusal", async () => {
    const { transport } = fakeTransport({
      answer: () => refusedWith({ kind: "levelsChanged", column: 2, basedOn: 2, levelsAt: 3 }),
    });
    const connection = await connect(transport, failOnDefect);
    expect(
      await connection.assignRows(
        column(2),
        { kind: "population", code: code(2) },
        new Uint8Array([1]),
      ),
    ).toEqual({ ok: true, value: "stale" });
  });
});

describe("the window's clock", () => {
  test("that gives a time that is not finite makes a command a defect", async () => {
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { transport } = fakeTransport();
      const connection = await connect({ ...transport, now: () => time }, failOnDefect);
      await expect(connection.setHover(null)).rejects.toThrow(/defect: the window's clock/);
      await expect(connection.setSelection(new Uint8Array([0]))).rejects.toThrow(/clock/);
    }
  });
});

describe("through Tauri's real channel", () => {
  /**
   * Tauri's internals as `@tauri-apps/api` calls them, replaced: the
   * callbacks the Channel registers, and an invoke that answers the
   * subscribe with the snapshot. `send` delivers a message as Tauri does,
   * with its index.
   */
  function installTauri(): { send: (index: number, message: unknown) => void } {
    const callbacks = new Map<number, (response: unknown) => void>();
    let channelId: number | null = null;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __TAURI_INTERNALS__: {
          transformCallback: (callback: (response: unknown) => void): number => {
            const id = callbacks.size + 1;
            callbacks.set(id, callback);
            return id;
          },
          unregisterCallback: (id: number): void => {
            callbacks.delete(id);
          },
          invoke: (command: string, args: unknown): Promise<unknown> => {
            if (command === "subscribe") {
              channelId = callbacks.size;
              expect(typeof args).toBe("object");
              return Promise.resolve(SNAPSHOT);
            }
            return Promise.resolve(null);
          },
        },
      },
    });
    return {
      send: (index, message) => {
        const callback = channelId === null ? undefined : callbacks.get(channelId);
        if (callback === undefined) {
          throw new Error("no channel");
        }
        callback({ index, message });
      },
    };
  }

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  test("messages delivered out of order are applied in order", async () => {
    const tauri = installTauri();
    const connection = await connect(tauriTransport(), failOnDefect);
    tauri.send(1, selectionAt(3, 0b0011));
    tauri.send(0, selectionAt(2, 0b1100));
    expect(connection.state.revision()).toBe(3);
    expect([...(connection.state.selection() ?? [])]).toEqual([0b0011]);
  });

  test("a defect never reaches Tauri's code, and later messages are ignored", async () => {
    const tauri = installTauri();
    const defects: string[] = [];
    const connection = await connect(tauriTransport(), (error) => {
      defects.push(error.message);
    });
    expect(() => {
      tauri.send(0, selectionAt(3, 0b0011));
    }).not.toThrow();
    expect(() => {
      tauri.send(1, selectionAt(2, 0b1100));
    }).not.toThrow();
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatch(/revision 2 is missing/);
    expect(connection.state.revision()).toBe(1);
  });
});

describe("the description of the table", () => {
  const DESCRIPTION = {
    loadedAt: 1,
    shapeAt: 1,
    numRows: 4,
    names: { id: 0, header: "IndividualID" },
    columns: [
      { id: 1, name: "height", revision: 1, storage: "float", role: "number", roles: ["number"] },
      {
        id: 2,
        name: "origin",
        revision: 1,
        storage: "text",
        role: "category",
        roles: ["category", "text"],
        levels: [
          { value: "Spain", colour: "#e69f00" },
          { value: "Peru", colour: "#56b4e9" },
        ],
      },
      {
        id: 3,
        name: "cluster",
        revision: 1,
        storage: "integer",
        role: "category",
        roles: ["number", "category"],
        levels: [{ value: "-12", colour: "#e69f00" }],
      },
    ],
  };

  test("comes back as it was sent, once checked", async () => {
    const { transport, calls } = fakeTransport({ answer: () => Promise.resolve(DESCRIPTION) });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.describeTable()).toEqual({ ok: true, value: DESCRIPTION });
    expect(calls.at(-1)).toEqual({ command: "describe_table", args: {}, headers: undefined });
  });

  test("with no project open is a refusal", async () => {
    const { transport } = fakeTransport({ answer: () => refusedWith({ kind: "noProject" }) });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.describeTable()).toEqual({ ok: false, error: { kind: "noProject" } });
  });

  test("that does not fit is a defect", async () => {
    const height = { id: 1, name: "height", revision: 1, storage: "float", roles: ["number"] };
    const origin = {
      id: 2,
      name: "origin",
      revision: 1,
      storage: "text",
      role: "category",
      roles: ["category"],
    };
    const withoutShape = Object.fromEntries(
      Object.entries(DESCRIPTION).filter(([key]) => key !== "shapeAt"),
    );
    for (const wrong of [
      { ...DESCRIPTION, numRows: -1 },
      withoutShape,
      { ...DESCRIPTION, columns: [{ ...height, role: "date" }] },
      // A number of text, and text of numbers, which the core never sends.
      { ...DESCRIPTION, columns: [{ ...height, storage: "text", role: "number" }] },
      { ...DESCRIPTION, columns: [{ ...height, role: "text" }] },
      // A role not among the roles the column can take.
      { ...DESCRIPTION, columns: [{ ...height, role: "latitude" }] },
      // Levels on a number.
      { ...DESCRIPTION, columns: [{ ...height, role: "number", levels: [] }] },
      { ...DESCRIPTION, columns: [{ ...origin, levels: [{ value: "Spain", colour: "red" }] }] },
      { ...DESCRIPTION, columns: [{ ...origin, levels: [{ value: "", colour: "#e69f00" }] }] },
      // A whole number as a JSON number, which cannot hold every one.
      {
        ...DESCRIPTION,
        columns: [{ ...origin, storage: "integer", levels: [{ value: 12, colour: "#e69f00" }] }],
      },
    ]) {
      const { transport } = fakeTransport({ answer: () => Promise.resolve(wrong) });
      const connection = await connect(transport, failOnDefect);
      await expect(connection.describeTable()).rejects.toThrow(/defect: a description/);
    }
  });
});

/**
 * Rows 1 and 2 of `origin`, column 1, at revision 1 of a table loaded at
 * 1: p2 in Peru, p3 missing, as the core writes them in
 * src-tauri/src/commands/tests.rs.
 */
// prettier-ignore
const PAGE = buffer(
  ...header(3, 1),
  ...[8, 0, 0, 0, 40, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  ...[1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0],
  ...[9, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 0x70, 0x32, 0x70, 0x33],
  ...[10, 0, 0, 0, 20, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  ...[1, 0, 0xff, 0xff, 0, 0, 0, 0],
);

describe("fetching rows", () => {
  test("asks with the window's revision and no time, and gives the page decoded", async () => {
    const { transport, calls } = fakeTransport({ answer: () => Promise.resolve(PAGE) });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.fetchRows(position(1), 2, [column(1)])).toEqual({
      ok: true,
      value: {
        revision: 1,
        loadedAt: 1,
        shownAt: 1,
        namesAt: 1,
        first: 1,
        count: 2,
        rows: [1, 2],
        names: ["p2", "p3"],
        columns: [{ id: 1, revision: 1, type: "categorical", codes: [1, null] }],
      },
    });
    expect(calls.at(-1)).toEqual({
      command: "fetch_rows",
      args: { first: 1, count: 2, columns: [1], basedOn: 1 },
      headers: undefined,
    });
  });

  test("asked before the table was replaced is stale", async () => {
    const { transport } = fakeTransport({
      answer: () => refusedWith({ kind: "madeBeforeLoad", basedOn: 1, loadedAt: 2 }),
    });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.fetchRows(position(1), 2, [column(1)])).toEqual({
      ok: true,
      value: "stale",
    });
  });

  test("refused gives the refusal as a value", async () => {
    const refusal = { kind: "rowsOutOfRange", first: 3, count: 2, numShown: 4 };
    const { transport } = fakeTransport({ answer: () => refusedWith(refusal) });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.fetchRows(position(3), 2, [])).toEqual({ ok: false, error: refusal });
  });

  test("refused as a defect is a defect", async () => {
    const { transport } = fakeTransport({
      answer: () => refusedWith({ kind: "defect", what: "a broken page" }),
    });
    const connection = await connect(transport, failOnDefect);
    await expect(connection.fetchRows(position(1), 2, [column(1)])).rejects.toThrow(
      /defect: the backend, on the command fetch_rows: a broken page/,
    );
  });

  test("answered with what is not bytes is a defect", async () => {
    const { transport } = fakeTransport({ answer: () => Promise.resolve([3, 0, 0]) });
    const connection = await connect(transport, failOnDefect);
    await expect(connection.fetchRows(position(1), 2, [column(1)])).rejects.toThrow(
      /defect: a page of rows that is not bytes, as after Tauri's fallback to postMessage/,
    );
  });

  test("answered with another page than the one asked for is a defect", async () => {
    const { transport } = fakeTransport({ answer: () => Promise.resolve(PAGE) });
    const connection = await connect(transport, failOnDefect);
    await expect(connection.fetchRows(position(0), 2, [column(1)])).rejects.toThrow(
      /defect: a page of 2 rows from position 1 with columns 1, asked for as 2 rows from position 0 with columns 1/,
    );
    await expect(connection.fetchRows(position(1), 2, [column(1), column(2)])).rejects.toThrow(
      /defect: a page of 2 rows from position 1 with columns 1, asked for as 2 rows from position 1 with columns 1, 2/,
    );
  });
});

describe("setting the filter", () => {
  test("sends the filter and the decimal mark with the window's revision", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    const filter = {
      text: "Spain",
      column: column(2),
      cell: "whole",
      showing: "notMatching",
    } as const;
    expect(await connection.setFilter(filter, ",")).toEqual({ ok: true, value: "applied" });
    expect(calls.at(-1)).toEqual({
      command: "set_filter",
      args: {
        text: "Spain",
        column: 2,
        cell: "whole",
        showing: "notMatching",
        decimalMark: ",",
        basedOn: 1,
        sentAt: 1_727_865_600_000.5,
      },
      headers: undefined,
    });
  });
});

describe("setting a role", () => {
  test("sends the column and the role with the window's revision", async () => {
    const { transport, calls } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    expect(await connection.setRole(column(2), "category")).toEqual({
      ok: true,
      value: "applied",
    });
    expect(calls.at(-1)).toEqual({
      command: "set_role",
      args: { column: 2, role: "category", basedOn: 1, sentAt: 1_727_865_600_000.5 },
      headers: undefined,
    });
  });

  test("refused for a storage type that cannot take it gives the refusal as a value", async () => {
    const refusal = { kind: "roleNotPossible", column: 2, storage: "text", role: "number" };
    const { transport } = fakeTransport({ answer: () => refusedWith(refusal) });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.setRole(column(2), "number")).toEqual({ ok: false, error: refusal });
  });
});

/** The message of an action of `code`, as the core writes it (crates/vavilov-core/src/action/tests.rs). */
function actionAt(code: number): ArrayBuffer {
  // prettier-ignore
  return buffer(
    4, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    12, 0, 0, 0, 8, 0, 0, 0,
    code, 0, 0, 0, 0, 0, 0, 0,
  );
}

describe("an item of the menu", () => {
  test("goes to the window's listener, and not to its copy of the state", async () => {
    const { transport, deliver } = fakeTransport();
    const connection = await connect(transport, failOnDefect);
    const actions: string[] = [];
    connection.onAction((action) => actions.push(action));
    deliver(actionAt(1));
    deliver(actionAt(3));
    expect(actions).toEqual(["importTable", "exportXlsx"]);
    expect(connection.state.revision()).toBe(1);
  });

  test("that comes before the window listens waits for it", async () => {
    const { transport, deliver } = fakeTransport({ early: [actionAt(2)] });
    const connection = await connect(transport, failOnDefect);
    deliver(actionAt(1));
    const actions: string[] = [];
    connection.onAction((action) => actions.push(action));
    expect(actions).toEqual(["exportCsv", "importTable"]);
  });
});

describe("an import and an export", () => {
  test("send the time of an import and the revision of an export, and give the backend's answer", async () => {
    const answers: unknown[] = [
      { kind: "imported", fileName: "plants.csv", undecodedLine: 3 },
      { kind: "exported", fileName: "plants.xlsx" },
    ];
    const { transport, calls } = fakeTransport({
      answer: () => Promise.resolve(answers.shift()),
    });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.importTable()).toEqual({
      ok: true,
      value: { kind: "imported", fileName: "plants.csv", undecodedLine: 3 },
    });
    expect(await connection.exportTable({ kind: "xlsx" })).toEqual({
      ok: true,
      value: { kind: "exported", fileName: "plants.xlsx" },
    });
    expect(calls.slice(1).map((call) => [call.command, call.args])).toEqual([
      ["import_table", { sentAt: 1_727_865_600_000.5 }],
      ["export_table", { format: { kind: "xlsx" }, basedOn: 1 }],
    ]);
  });

  test("refused give the refusal of the file as a value", async () => {
    const refused = {
      kind: "importRefused",
      fileName: "plants.csv",
      refusal: { kind: "empty" },
    };
    const { transport } = fakeTransport({ answer: () => refusedWith(refused) });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.importTable()).toEqual({ ok: false, error: refused });
  });

  test("with an answer that does not fit are a defect", async () => {
    const { transport } = fakeTransport({
      answer: () => Promise.resolve({ kind: "imported", fileName: "plants.csv" }),
    });
    const connection = await connect(transport, failOnDefect);
    await expect(connection.importTable()).rejects.toThrow(
      /defect: an answer of import_table that does not fit/,
    );
  });
});

describe("the decimal mark of the system's region", () => {
  test("comes back as the backend reads it", async () => {
    const { transport, calls } = fakeTransport({ answer: () => Promise.resolve(",") });
    const connection = await connect(transport, failOnDefect);
    expect(await connection.regionDecimalMark()).toBe(",");
    expect(calls.at(-1)).toEqual({
      command: "region_decimal_mark",
      args: {},
      headers: undefined,
    });
  });

  test("that is not a mark, or that the backend could not read, is a defect", async () => {
    for (const answer of [
      () => Promise.resolve(""),
      () => Promise.resolve(44),
      () => refusedWith({ kind: "defect", what: "no region" }),
    ]) {
      const { transport } = fakeTransport({ answer });
      const connection = await connect(transport, failOnDefect);
      await expect(connection.regionDecimalMark()).rejects.toThrow(/defect: .*decimal mark/);
    }
  });
});
