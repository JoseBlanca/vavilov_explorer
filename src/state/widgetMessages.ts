// The words the information bar of the main window shows when a plot
// cannot be opened, written from what the window knows, a column the table
// can no longer show, or from the app's refusal of a window the system
// could not open (.claude/skills/writing/SKILL.md, "The text of the app").
// No window was opened.

import type { BarMessage } from "./barMessages.ts";
import type { CommandError } from "./commandError.ts";
import type { Role } from "./description.ts";
import type { ColumnId } from "./ids.ts";
import type { UnfitColumn } from "./plotColumns.ts";
import type { WidgetKind } from "./widget.ts";

/** The name of each kind of widget, as a sentence says it. */
const WIDGET_WORDS: Readonly<Record<WidgetKind, string>> = {
  scatter3d: "3D scatter",
  map: "map",
  countryMap: "map of countries",
  histogram: "histogram",
};

/** The error shown when the table has no column of numbers, which a 3D scatter or a histogram needs. */
export function noNumbersMessage(kind: "scatter3d" | "histogram"): BarMessage {
  return {
    kind: "error",
    text: `No ${WIDGET_WORDS[kind]} was opened: the table has no column of numbers. A column of numbers shown as a category becomes one when “number” is chosen as its role.`,
  };
}

/** The words of a computer whose web view cannot draw WebGL (decided by the owner on 3 October 2026). */
export const NO_WEBGL_WORDS = "WebGL plots are not supported on this computer.";

/** The error shown when the web view cannot draw WebGL, and no window was opened. */
export function noWebGlMessage(): BarMessage {
  return { kind: "error", text: NO_WEBGL_WORDS };
}

/** The roles a map needs of a column: a latitude and a longitude, or the countries. */
export type MapRole = Extract<Role, "latitude" | "longitude" | "country">;

/**
 * The error shown when the table has no column of `role`, which a map
 * needs, and no window was opened.
 */
export function noColumnMessage(role: MapRole): BarMessage {
  switch (role) {
    case "latitude":
      return {
        kind: "error",
        text: "No map was opened: the table has no latitude column. A column of numbers from −90 to 90 becomes one when “latitude” is chosen as its role.",
      };
    case "longitude":
      return {
        kind: "error",
        text: "No map was opened: the table has no longitude column. A column of numbers from −180 to 180 becomes one when “longitude” is chosen as its role.",
      };
    case "country":
      return {
        kind: "error",
        text: "No map of countries was opened: the table has no column of countries. A column of text that names countries by their ISO codes or names becomes one when “country” is chosen as its role.",
      };
  }
}

/** A refusal of open_widget the window shows: a window the system could not open. */
export type WidgetRefused = Extract<CommandError, { readonly kind: "windowFailed" }>;

/** Whether `error` is a refusal of open_widget the window shows. */
export function isWidgetRefused(error: CommandError): error is WidgetRefused {
  return error.kind === "windowFailed";
}

/**
 * Why a widget was not opened: a column the table, described again as the
 * user chose Open, can no longer show as the widget needs it, or the app's
 * refusal.
 */
export type WidgetNotOpened = ({ readonly kind: "unfit" } & UnfitColumn) | WidgetRefused;

/** A column of `role`, as a sentence says it. */
function roleWords(role: Role): string {
  switch (role) {
    case "latitude":
      return "a latitude column";
    case "longitude":
      return "a longitude column";
    case "country":
      return "a column of countries";
    case "number":
      return "a column of numbers";
    case "category":
      return "a category";
    case "text":
      return "a column of text";
  }
}

/**
 * The error shown for a widget of `kind` that was not opened, for `why`,
 * with `columnName` the name of a column of the window's copy, or `null`
 * when the copy does not have it.
 */
export function widgetRefusalMessage(
  kind: WidgetKind,
  why: WidgetNotOpened,
  columnName: (column: ColumnId) => string | null,
): BarMessage {
  const opened = `No ${WIDGET_WORDS[kind]} was opened`;
  const noLonger = (column: ColumnId, role: Role): BarMessage => {
    const name = columnName(column);
    const which = name === null ? "one of its columns" : `“${name}”`;
    return { kind: "error", text: `${opened}: ${which} is no longer ${roleWords(role)}.` };
  };
  switch (why.kind) {
    case "unfit":
      return noLonger(why.column, why.role);
    case "windowFailed":
      return {
        kind: "error",
        text: `${opened}: the system could not open its window. Closing other windows may let it open.`,
      };
  }
}
