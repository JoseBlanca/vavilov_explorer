// The words the information bar of the main window shows when a 3D
// scatter cannot be opened, written from what the window knows or from the
// backend's refusal (.claude/skills/writing/SKILL.md, "The text of the
// app"). No window was opened.

import type { BarMessage } from "./barMessages.ts";
import type { CommandError } from "./commandError.ts";
import type { ColumnId } from "./ids.ts";

/** The error shown when the table has no column a 3D scatter can put on an axis. */
export function noNumbersMessage(): BarMessage {
  return {
    kind: "error",
    text: "No 3D scatter was opened: the table has no column of numbers. A column of numbers shown as a category becomes one when “number” is chosen as its role.",
  };
}

/** The words of a computer whose web view cannot draw WebGL (decided by the owner on 3 October 2026). */
export const NO_WEBGL_WORDS = "WebGL plots are not supported on this computer.";

/** The error shown when the web view cannot draw WebGL, and no window was opened. */
export function noWebGlMessage(): BarMessage {
  return { kind: "error", text: NO_WEBGL_WORDS };
}

/** A refusal of open_widget the window shows. */
export type WidgetRefused = Extract<CommandError, { readonly kind: "notNumber" | "windowFailed" }>;

/** Whether `error` is a refusal of open_widget the window shows. */
export function isWidgetRefused(error: CommandError): error is WidgetRefused {
  return error.kind === "notNumber" || error.kind === "windowFailed";
}

/**
 * The error shown for a 3D scatter the backend refused to open, with
 * `columnName` the name of a column of the window's copy, or `null` when
 * the copy does not have it.
 */
export function widgetRefusalMessage(
  error: WidgetRefused,
  columnName: (column: ColumnId) => string | null,
): BarMessage {
  switch (error.kind) {
    case "notNumber": {
      const name = columnName(error.column);
      return {
        kind: "error",
        text:
          name === null
            ? "No 3D scatter was opened: one of its columns is no longer a column of numbers."
            : `No 3D scatter was opened: “${name}” is no longer a column of numbers.`,
      };
    }
    case "windowFailed":
      return {
        kind: "error",
        text: "No 3D scatter was opened: the system could not open its window. Closing other windows may let it open.",
      };
  }
}
