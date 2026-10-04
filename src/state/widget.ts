// What a widget shows, its kind and its columns, the app layer's WidgetSpec
// (src-tauri/src/widgets.rs): the argument of open_widget, and with its
// number, in the list of a window's widgets; and the kinds of window the
// widgets are drawn in.

import { defect } from "./defect.ts";
import type { ColumnId, WidgetId } from "./ids.ts";
import { isColumnIdField, taggedDecoder } from "./tagged.ts";
import type { Tagged } from "./tagged.ts";

/** The three columns of a 3D scatter, on its x, y and z axes. */
export type Axes = readonly [ColumnId, ColumnId, ColumnId];

function isAxes(value: unknown): value is Axes {
  return Array.isArray(value) && value.length === 3 && value.every(isColumnIdField);
}

/** The fields of each kind of widget, and the check of each. */
const FIELDS = {
  scatter3d: { axes: isAxes },
  map: { latitude: isColumnIdField, longitude: isColumnIdField },
  countryMap: { country: isColumnIdField },
  histogram: { column: isColumnIdField },
};

/**
 * What a widget shows: a 3D scatter of three numeric columns, a map of the
 * individuals by a latitude and a longitude column, a map of the countries
 * of a country column, or a histogram of a numeric column.
 */
export type WidgetSpec = Tagged<typeof FIELDS>;

/** Whether `value` is what a widget shows, with exactly the fields of its kind. */
export const isWidgetSpec: (value: unknown) => value is WidgetSpec = taggedDecoder(FIELDS);

/** The kinds of widget. */
export type WidgetKind = WidgetSpec["kind"];

/** An open widget of a window: its number and what it shows. */
export interface Widget {
  /** Its number, which no other widget has. */
  readonly id: WidgetId;
  /** What it shows. */
  readonly spec: WidgetSpec;
}

/**
 * The kinds of window of the widgets, as the start of their labels
 * (`WindowKind` of the app layer, src-tauri/src/widgets.rs): a 3D
 * scatter's, the Plots window of the histograms, and the Maps window of
 * the maps.
 */
export const WINDOW_KINDS = ["scatter3d", "plots", "maps"] as const;

/** A kind of window of the widgets. */
export type WindowKind = (typeof WINDOW_KINDS)[number];

/**
 * The kind of window labelled `label`, such as `scatter3d-1` or `plots-2`,
 * or `null` for a label of no window of widgets, the main window's among
 * them.
 */
export function windowKindOf(label: string): WindowKind | null {
  const kind = /^([a-z][a-zA-Z0-9]*)-[1-9][0-9]*$/.exec(label)?.[1];
  return WINDOW_KINDS.find((each) => each === kind) ?? null;
}

/**
 * The one widget of a window of a kind that holds one, a 3D scatter's
 * window.
 *
 * @throws A defect when the window holds none, or more than one.
 */
export function onlyWidget(widgets: readonly Widget[]): Widget {
  const [widget, ...rest] = widgets;
  if (widget === undefined || rest.length > 0) {
    throw defect(`a window of one widget that holds ${String(widgets.length)}`);
  }
  return widget;
}

/**
 * The widgets of a window, as the app layer gives them, with a sequence
 * number that only grows, so that a window keeps the newer of a list it
 * asked for and one sent on its channel, which can arrive in either order.
 */
export interface WidgetList {
  /** The sequence number of the list. */
  readonly seq: number;
  /** The widgets, in the order they were opened. */
  readonly widgets: readonly Widget[];
}
