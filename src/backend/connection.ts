// The window's connection to the backend: it subscribes, keeps the window's
// copy of the state up to date from the channel, and sends the commands
// (docs/core.md, sections 4 and 5).

import { isCommandError } from "../state/commandError.ts";
import type { CommandError } from "../state/commandError.ts";
import { defect } from "../state/defect.ts";
import type { ColumnId, LevelCode, RowIndex } from "../state/ids.ts";
import type { Result } from "../state/result.ts";
import { createWindowState } from "../state/windowState.ts";
import type { WindowState } from "../state/windowState.ts";
import { decodeMessage } from "./decodeMessage.ts";
import type { Transport } from "./transport.ts";

/** A command's answer: done, or the backend's refusal. */
export type Answer = Result<null, CommandError>;

/** A window's connection: its copy of the state and the commands it sends. */
export interface Connection {
  /** The window's copy of the shared state, which every change reaches. */
  readonly state: WindowState;
  /** Sets the selection, one bit per row of the table. */
  readonly setSelection: (bits: Uint8Array) => Promise<Answer>;
  /** Sets the individual under the pointer, or none. */
  readonly setHover: (row: RowIndex | null) => Promise<Answer>;
  /** Sets the active classification, or none. */
  readonly setActiveClassification: (column: ColumnId | null) => Promise<Answer>;
  /** Selects a population of the active classification for editing, or none. */
  readonly selectPopulation: (column: ColumnId, population: LevelCode | null) => Promise<Answer>;
  /** Assigns the rows of a lasso, one bit per row, to the selected population. */
  readonly assignRows: (
    column: ColumnId,
    population: LevelCode,
    bits: Uint8Array,
  ) => Promise<Answer>;
  /** Leaves unassigned the rows of a lasso that are in the selected population. */
  readonly unassignRows: (
    column: ColumnId,
    population: LevelCode,
    bits: Uint8Array,
  ) => Promise<Answer>;
  /** Undoes the last edit. */
  readonly undo: () => Promise<Answer>;
  /** Redoes the last edit undone. */
  readonly redo: () => Promise<Answer>;
}

/**
 * Subscribes the window and returns its connection, once the snapshot is in.
 * What the channel delivers before the snapshot arrives is kept, and applied
 * after it: the state drops the changes the snapshot already holds, and the
 * hovers not newer than its own.
 *
 * @throws A defect when the backend refuses the subscribe or sends what does
 * not decode.
 */
export async function connect(transport: Transport): Promise<Connection> {
  const early: ArrayBuffer[] = [];
  let state: WindowState | null = null;
  const channel = transport.channel((message) => {
    if (!(message instanceof ArrayBuffer)) {
      throw defect(`a channel message that is not bytes: ${describe(message)}`);
    }
    if (state === null) {
      early.push(message);
    } else {
      state.apply(decodeMessage(message));
    }
  });
  let snapshot: unknown;
  try {
    snapshot = await transport.invoke("subscribe", { onChange: channel });
  } catch (error: unknown) {
    throw defect(`the backend refused the subscribe: ${describe(error)}`);
  }
  if (!(snapshot instanceof ArrayBuffer)) {
    throw defect(`a snapshot that is not bytes: ${describe(snapshot)}`);
  }
  const ready = createWindowState(decodeMessage(snapshot));
  for (const message of early.splice(0)) {
    ready.apply(decodeMessage(message));
  }
  state = ready;

  /** A command with JSON arguments, with the revision and the time. */
  const command = (name: string, args: Readonly<Record<string, unknown>>): Promise<Answer> =>
    answer(
      name,
      transport.invoke(name, { ...args, basedOn: ready.revision(), sentAt: transport.now() }),
    );

  /** A command whose rows go as raw bytes, the rest in headers. */
  const withRows = (
    name: string,
    bits: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<Answer> =>
    answer(
      name,
      transport.invoke(name, bits, {
        ...headers,
        "based-on": String(ready.revision()),
        "sent-at": String(transport.now()),
      }),
    );

  const lassoHeaders = (column: ColumnId, population: LevelCode): Record<string, string> => ({
    column: String(column),
    population: String(population),
  });

  return {
    state: ready,
    setSelection: (bits) => withRows("set_selection", bits, {}),
    setHover: (row) => command("set_hover", { row }),
    setActiveClassification: (column) => command("set_active_classification", { column }),
    selectPopulation: (column, population) => command("select_population", { column, population }),
    assignRows: (column, population, bits) =>
      withRows("assign_rows", bits, lassoHeaders(column, population)),
    unassignRows: (column, population, bits) =>
      withRows("unassign_rows", bits, lassoHeaders(column, population)),
    undo: () => command("undo", {}),
    redo: () => command("redo", {}),
  };
}

/**
 * The answer of a command: done, or the backend's refusal as a value. A
 * refusal as a defect, or a failure that is not a refusal, is thrown.
 */
async function answer(name: string, call: Promise<unknown>): Promise<Answer> {
  try {
    await call;
    return { ok: true, value: null };
  } catch (error: unknown) {
    if (!isCommandError(error)) {
      throw defect(`the command ${name} failed with ${describe(error)}`);
    }
    if (error.kind === "defect") {
      throw defect(`the backend, on the command ${name}: ${error.what}`);
    }
    return { ok: false, error };
  }
}

/** A value of unknown type, as text for a defect's message. */
function describe(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (value === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return `a value of type ${typeof value} with no JSON form`;
  }
}
