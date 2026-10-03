// What a widget shows, its kind and its columns, as the core's WidgetSpec
// crosses to a window (crates/vavilov-core/src/widgets.rs): the argument of
// open_widget and the answer of describe_widget.

import type { ColumnId } from "./ids.ts";
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
};

/** What a widget shows: a 3D scatter of three numeric columns. */
export type WidgetSpec = Tagged<typeof FIELDS>;

/** Whether `value` is what a widget shows, with exactly the fields of its kind. */
export const isWidgetSpec: (value: unknown) => value is WidgetSpec = taggedDecoder(FIELDS);

/** The kinds of widget, as the start of their windows' labels. */
export type WidgetKind = WidgetSpec["kind"];

/**
 * The kind of widget of the window labelled `label`, such as `scatter3d-1`,
 * or `null` for a label of no widget, the main window's among them.
 */
export function widgetKindOf(label: string): WidgetKind | null {
  const kind = /^([a-z0-9]+)-[1-9][0-9]*$/.exec(label)?.[1];
  return WIDGET_KINDS.find((each) => each === kind) ?? null;
}

/** Every kind of widget, from the fields of each. */
const WIDGET_KINDS: readonly WidgetKind[] = Object.keys(FIELDS).filter(
  (kind): kind is WidgetKind => kind in FIELDS,
);
