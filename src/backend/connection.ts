// The window's connection to the backend: it subscribes, keeps the window's
// copy of the state up to date from the channel, and sends the commands
// (docs/core.md, sections 4 and 5).

import { isCommandError } from "../state/commandError.ts";
import type { Refusal } from "../state/commandError.ts";
import { isTableDescription } from "../state/description.ts";
import type { Role, TableDescription } from "../state/description.ts";
import type { Selected } from "../state/message.ts";
import { defect } from "../state/defect.ts";
import type { ColumnId, LevelCode, RowIndex } from "../state/ids.ts";
import type { Result } from "../state/result.ts";
import type { RowPage } from "../state/rowPage.ts";
import { exportAnswerOf, importAnswerOf } from "../state/transfer.ts";
import type { ExportAnswer, ExportFormat, ImportAnswer, MenuAction } from "../state/transfer.ts";
import { createWindowState } from "../state/windowState.ts";
import type { WindowState } from "../state/windowState.ts";
import { decodeAction, isActionMessage } from "./decodeAction.ts";
import { decodeMessage } from "./decodeMessage.ts";
import { decodeRows } from "./decodeRows.ts";
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
  /**
   * Selects a population of the active classification, or its unassigned
   * individuals, for editing, or nothing.
   */
  readonly selectPopulation: (column: ColumnId, selected: Selected | null) => Promise<Answer>;
  /**
   * Assigns the rows of a lasso, one bit per row, to what is selected; with
   * the unassigned individuals selected, leaves them unassigned.
   */
  readonly assignRows: (column: ColumnId, target: Selected, rows: Uint8Array) => Promise<Answer>;
  /** Leaves unassigned the rows of a lasso that are in the selected population. */
  readonly unassignRows: (
    column: ColumnId,
    population: LevelCode,
    rows: Uint8Array,
  ) => Promise<Answer>;
  /** Sets the role of a column other than the first. */
  readonly setRole: (column: ColumnId, role: Role) => Promise<Answer>;
  /** Undoes the last edit. */
  readonly undo: () => Promise<Answer>;
  /** Redoes the last edit undone. */
  readonly redo: () => Promise<Answer>;
  /** The description of the table, or the refusal when no project is open. */
  readonly describeTable: () => Promise<Result<TableDescription, Refusal>>;
  /**
   * `count` rows from `first`, with the names and the values of `columns` in
   * that order, or "stale" when the table was replaced after the window's
   * copy was made, or the backend's refusal.
   */
  readonly fetchRows: (
    first: RowIndex,
    count: number,
    columns: readonly ColumnId[],
  ) => Promise<Result<RowPage | "stale", Refusal>>;
  /**
   * Imports a table: the backend asks the user for the file with the
   * system's dialog, and loads its table, or gives the refusal.
   */
  readonly importTable: () => Promise<Result<ImportAnswer | "stale", Refusal>>;
  /**
   * Exports the table of the window's copy: the backend refuses a table
   * that would not read back as itself, then asks the user where to save it.
   */
  readonly exportTable: (format: ExportFormat) => Promise<Result<ExportAnswer | "stale", Refusal>>;
  /**
   * Calls `listener` with each item of the menu the backend hands to the
   * window, and returns the function that stops it.
   */
  readonly onAction: (listener: (action: MenuAction) => void) => () => void;
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
 * channel, and every command it would send is a defect instead: the window's
 * copy can no longer be trusted, and a change made from it could land on
 * rows or populations the user does not see. The window shows the defect;
 * a reload subscribes it again.
 *
 * @throws A defect when the backend refuses the subscribe or sends a snapshot
 * that does not decode.
 */
export async function connect(
  transport: Transport,
  onDefect: (error: Error) => void,
): Promise<Connection> {
  const early: ArrayBuffer[] = [];
  const actionListeners = new Set<(action: MenuAction) => void>();
  /** Actions that came before the window listened for them, as while it starts. */
  const waitingActions: MenuAction[] = [];
  let state: WindowState | null = null;
  let broken = false;
  /** A message of the channel: an action goes to its listeners, the rest to the copy. */
  const take = (ready: WindowState, message: ArrayBuffer): void => {
    if (isActionMessage(message)) {
      const action = decodeAction(message);
      if (actionListeners.size === 0) {
        waitingActions.push(action);
        return;
      }
      for (const listener of actionListeners) {
        listener(action);
      }
      return;
    }
    ready.apply(decodeMessage(message));
  };
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
        take(state, message);
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
  state = ready;
  for (const message of early.splice(0)) {
    take(ready, message);
  }

  /** The window's clock, which must give a finite time. */
  const now = (): number => {
    const time = transport.now();
    if (!Number.isFinite(time)) {
      throw defect(`the window's clock gave ${String(time)}`);
    }
    return time;
  };

  /** Throws a defect for a command made from a copy that met a defect. */
  const checkSound = (name: CommandName): void => {
    if (broken) {
      throw defect(`the command ${name}, from a copy of the state that met a defect`);
    }
  };

  /** A command with JSON arguments, with the revision and the time. */
  const command = async (
    name: CommandName,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Answer> => {
    checkSound(name);
    return answer(
      name,
      transport.invoke(name, { ...args, basedOn: ready.revision(), sentAt: now() }),
    );
  };

  /** A command whose rows go as raw bytes, the rest in headers. */
  const withRows = async (
    name: CommandName,
    rows: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<Answer> => {
    checkSound(name);
    return answer(
      name,
      transport.invoke(name, rows, {
        ...headers,
        "based-on": String(ready.revision()),
        "sent-at": String(now()),
      }),
    );
  };

  /** A selection as the backend reads one in JSON. */
  const selectedArg = (selected: Selected | null): unknown =>
    selected === null
      ? null
      : selected.kind === "unassigned"
        ? "unassigned"
        : { population: selected.code };

  return {
    state: ready,
    setSelection: (rows) => withRows("set_selection", rows, {}),
    setHover: (row) => command("set_hover", { row }),
    setActiveClassification: (column) => command("set_active_classification", { column }),
    selectPopulation: (column, selected) =>
      command("select_population", { column, selected: selectedArg(selected) }),
    assignRows: (column, target, rows) =>
      withRows("assign_rows", rows, {
        column: String(column),
        target: target.kind === "unassigned" ? "unassigned" : String(target.code),
      }),
    unassignRows: (column, population, rows) =>
      withRows("unassign_rows", rows, { column: String(column), population: String(population) }),
    describeTable: async () => {
      let description: unknown;
      try {
        description = await transport.invoke("describe_table", {});
      } catch (error: unknown) {
        if (!isCommandError(error) || error.kind === "defect" || error.kind === "madeBeforeLoad") {
          throw defect(`describe_table failed with ${describe(error)}`);
        }
        return { ok: false, error };
      }
      if (!isTableDescription(description)) {
        throw defect(`a description of the table that does not fit: ${describe(description)}`);
      }
      return { ok: true, value: description };
    },
    fetchRows: async (first, count, columns) => {
      let page: unknown;
      try {
        page = await transport.invoke("fetch_rows", {
          first,
          count,
          columns,
          basedOn: ready.revision(),
        });
      } catch (error: unknown) {
        return refusal("fetch_rows", error);
      }
      if (!(page instanceof ArrayBuffer)) {
        throw defect(
          `a page of rows that is not bytes, as after Tauri's fallback to postMessage: ${describe(page)}`,
        );
      }
      const decoded = decodeRows(page);
      const given = decoded.columns.map((column) => column.id);
      if (
        decoded.first !== first ||
        decoded.count !== count ||
        given.length !== columns.length ||
        given.some((id, index) => id !== columns[index])
      ) {
        throw defect(
          `a page of ${String(decoded.count)} rows from row ${String(decoded.first)} with columns ${given.join(", ")}, asked for as ${String(count)} rows from row ${String(first)} with columns ${columns.join(", ")}`,
        );
      }
      return { ok: true, value: decoded };
    },
    setRole: (column, role) => command("set_role", { column, role }),
    undo: () => command("undo", {}),
    redo: () => command("redo", {}),
    importTable: async () => {
      checkSound("import_table");
      let answer: unknown;
      try {
        answer = await transport.invoke("import_table", { sentAt: now() });
      } catch (error: unknown) {
        return refusal("import_table", error);
      }
      const value = importAnswerOf(answer);
      if (value === null) {
        throw defect(`an answer of import_table that does not fit: ${describe(answer)}`);
      }
      return { ok: true, value };
    },
    exportTable: async (format) => {
      checkSound("export_table");
      let answer: unknown;
      try {
        answer = await transport.invoke("export_table", { format, basedOn: ready.revision() });
      } catch (error: unknown) {
        return refusal("export_table", error);
      }
      const value = exportAnswerOf(answer);
      if (value === null) {
        throw defect(`an answer of export_table that does not fit: ${describe(answer)}`);
      }
      return { ok: true, value };
    },
    onAction: (listener) => {
      actionListeners.add(listener);
      for (const action of waitingActions.splice(0)) {
        listener(action);
      }
      return () => {
        actionListeners.delete(listener);
      };
    },
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
    return refusal(name, error);
  }
}

/**
 * A command's failure as a value: stale, or the backend's refusal. A refusal
 * as a defect, or a failure that is not a refusal, is thrown.
 */
function refusal(name: CommandName, error: unknown): Result<"stale", Refusal> {
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
