// What the window's connection needs of Tauri, apart, so that its tests
// replace only the transport (.claude/skills/coding/testing.md).

import { Channel, invoke } from "@tauri-apps/api/core";

/** The app's commands, as `src-tauri/src/commands.rs` names them. */
export type CommandName =
  | "subscribe"
  | "set_selection"
  | "assign_rows"
  | "unassign_rows"
  | "set_hover"
  | "set_active_classification"
  | "select_population"
  | "undo"
  | "redo";

/** The calls to the backend and the channel a window subscribes with. */
export interface Transport {
  /** Invokes a command with JSON arguments, or with raw bytes and headers. */
  readonly invoke: (
    command: CommandName,
    args: Readonly<Record<string, unknown>> | Uint8Array,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<unknown>;
  /** A channel whose messages go to `onMessage`, as the value to pass to `subscribe`. */
  readonly channel: (onMessage: (message: unknown) => void) => unknown;
  /** The window's clock, in milliseconds since the epoch, sent with each command. */
  readonly now: () => number;
}

/** The transport of the app, over Tauri's IPC. */
export function tauriTransport(): Transport {
  return {
    invoke: (command, args, headers) =>
      invoke(
        command,
        args instanceof Uint8Array ? args : { ...args },
        headers === undefined ? undefined : { headers: { ...headers } },
      ),
    channel: (onMessage) => new Channel<unknown>(onMessage),
    now: () => performance.timeOrigin + performance.now(),
  };
}
