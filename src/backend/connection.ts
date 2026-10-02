// The window's connection to the backend: it subscribes, keeps the window's
// copy of the state up to date from the channel, and sends the commands
// (docs/core.md, sections 4 and 5).

import { isCommandError } from "../state/commandError.ts";
import type { Refusal } from "../state/commandError.ts";
import { defect } from "../state/defect.ts";
import type { ColumnId, LevelCode, RowIndex } from "../state/ids.ts";
import type { Result } from "../state/result.ts";
import { createWindowState } from "../state/windowState.ts";
import type { WindowState } from "../state/windowState.ts";
import { decodeMessage } from "./decodeMessage.ts";
import type { CommandName, Transport } from "./transport.ts";

/**
 * A command's answer: applied, or dropped as stale because it was made before
 * the current table was loaded (which the window does not show, as the owner
 * decided), or the backend's refusal.
 */
export type Answer = Result<"applied" | "stale", Refusal>;

/** A window's connection: its copy of the state and the commands it sends. */
export interface Connection {
  /** The window's copy of the shared state, which every change reaches. */
  readonly state: WindowState;
  /** Sets the selection, one bit per row of the table. */
  readonly setSelection: (rows: Uint8Array) => Promise<Answer>;
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
    rows: Uint8Array,
  ) => Promise<Answer>;
  /** Leaves unassigned the rows of a lasso that are in the selected population. */
  readonly unassignRows: (
    column: ColumnId,
    population: LevelCode,
    rows: Uint8Array,
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
 * A defect met while a channel message is handled, a message that does not
 * decode, a skipped revision, a listener that throws, is given to `onDefect`
 * and never thrown back into Tauri's channel, which would then hold back
 * every later message, or swallow the error. The connection then ignores the
 * channel: the window's copy can no longer be trusted, and the window shows
 * the defect and subscribes again.
 *
 * @throws A defect when the backend refuses the subscribe or sends a snapshot
 * that does not decode.
 */
export async function connect(
  transport: Transport,
  onDefect: (error: Error) => void,
): Promise<Connection> {
  const early: ArrayBuffer[] = [];
  let state: WindowState | null = null;
  let broken = false;
  const channel = transport.channel((message) => {
    if (broken) {
      return;
    }
    try {
      if (!(message instanceof ArrayBuffer)) {
        throw defect(
          `a channel message that is not bytes, as after Tauri's fallback to postMessage: ${describe(message)}`,
        );
      }
      if (state === null) {
        early.push(message);
      } else {
        state.apply(decodeMessage(message));
      }
    } catch (error: unknown) {
      broken = true;
      onDefect(
        error instanceof Error ? error : defect(`a channel message failed: ${describe(error)}`),
      );
    }
  });
  let snapshot: unknown;
  try {
    snapshot = await transport.invoke("subscribe", { onChange: channel });
  } catch (error: unknown) {
    throw defect(`the backend refused the subscribe: ${describe(error)}`);
  }
  if (!(snapshot instanceof ArrayBuffer)) {
    throw defect(
      `a snapshot that is not bytes, as after Tauri's fallback to postMessage: ${describe(snapshot)}`,
    );
  }
  const ready = createWindowState(decodeMessage(snapshot));
  for (const message of early.splice(0)) {
    ready.apply(decodeMessage(message));
  }
  state = ready;

  /** The window's clock, which must give a finite time. */
  const now = (): number => {
    const time = transport.now();
    if (!Number.isFinite(time)) {
      throw defect(`the window's clock gave ${String(time)}`);
    }
    return time;
  };

  /** A command with JSON arguments, with the revision and the time. */
  const command = async (
    name: CommandName,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Answer> =>
    answer(name, transport.invoke(name, { ...args, basedOn: ready.revision(), sentAt: now() }));

  /** A command whose rows go as raw bytes, the rest in headers. */
  const withRows = async (
    name: CommandName,
    rows: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<Answer> =>
    answer(
      name,
      transport.invoke(name, rows, {
        ...headers,
        "based-on": String(ready.revision()),
        "sent-at": String(now()),
      }),
    );

  const lassoHeaders = (column: ColumnId, population: LevelCode): Record<string, string> => ({
    column: String(column),
    population: String(population),
  });

  return {
    state: ready,
    setSelection: (rows) => withRows("set_selection", rows, {}),
    setHover: (row) => command("set_hover", { row }),
    setActiveClassification: (column) => command("set_active_classification", { column }),
    selectPopulation: (column, population) => command("select_population", { column, population }),
    assignRows: (column, population, rows) =>
      withRows("assign_rows", rows, lassoHeaders(column, population)),
    unassignRows: (column, population, rows) =>
      withRows("unassign_rows", rows, lassoHeaders(column, population)),
    undo: () => command("undo", {}),
    redo: () => command("redo", {}),
  };
}

/**
 * The answer of a command: applied, stale, or the backend's refusal as a
 * value. A refusal as a defect, or a failure that is not a refusal, is thrown.
 */
async function answer(name: CommandName, call: Promise<unknown>): Promise<Answer> {
  try {
    await call;
    return { ok: true, value: "applied" };
  } catch (error: unknown) {
    if (!isCommandError(error)) {
      throw defect(`the command ${name} failed with ${describe(error)}`);
    }
    if (error.kind === "defect") {
      throw defect(`the backend, on the command ${name}: ${error.what}`);
    }
    if (error.kind === "madeBeforeLoad") {
      console.warn(
        `Vavilov Explorer: the command ${name}, made at revision ${String(error.basedOn)}, came after the table loaded at ${String(error.loadedAt)}, and was not applied`,
      );
      return { ok: true, value: "stale" };
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
