// The decoder of a window's list of widgets, which the app layer sends, as
// the answer of window_widgets and as a message of the window's channel
// (src-tauri/src/widgets.rs, WidgetList::to_bytes; docs/core.md, section 5).

import { defect } from "../state/defect.ts";
import { NO_COLUMN, isWidgetId } from "../state/ids.ts";
import type { ColumnId } from "../state/ids.ts";
import type { Widget, WidgetList, WidgetSpec } from "../state/widget.ts";
import { columnId, expectZeros } from "./layout.ts";

/** The kind of a message of a list of widgets, its byte 0. */
const WIDGETS_MESSAGE = 6;
/** The bytes before the first widget. */
const HEADER_BYTES = 24;
/** The bytes of one widget. */
const WIDGET_BYTES = 24;

/** Whether `bytes` is a message of a list of widgets, by its byte 0. */
export function isWidgetsMessage(bytes: ArrayBuffer): boolean {
  return bytes.byteLength > 0 && new DataView(bytes).getUint8(0) === WIDGETS_MESSAGE;
}

/**
 * The list of widgets of `bytes`: the kind, seven zero bytes; the sequence
 * number, `u64`; the number of widgets, `u32`, four zero bytes; then for
 * each its number, `u32`, the code of its kind, `u16`, two zero bytes, its
 * three columns, `u32` each, `NO_COLUMN` past those it has, and four zero
 * bytes.
 *
 * @throws A defect when the bytes are not such a list.
 */
export function decodeWidgetList(bytes: ArrayBuffer): WidgetList {
  if (bytes.byteLength < HEADER_BYTES || !isWidgetsMessage(bytes)) {
    throw defect(`a list of widgets of ${String(bytes.byteLength)} bytes that is not one`);
  }
  const view = new DataView(bytes);
  expectZeros(view, 1, 8, "bytes 1 to 7 of a list of widgets");
  const seq = view.getBigUint64(8, true);
  if (seq > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw defect(`a list of widgets of sequence ${String(seq)}`);
  }
  const count = view.getUint32(16, true);
  expectZeros(view, 20, 24, "bytes 20 to 23 of a list of widgets");
  if (bytes.byteLength !== HEADER_BYTES + count * WIDGET_BYTES) {
    throw defect(
      `a list of ${String(count)} widgets in ${String(bytes.byteLength)} bytes, not ${String(HEADER_BYTES + count * WIDGET_BYTES)}`,
    );
  }
  const widgets: Widget[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = HEADER_BYTES + index * WIDGET_BYTES;
    const id = view.getUint32(at, true);
    if (!isWidgetId(id)) {
      throw defect(`a widget ${String(id)}`);
    }
    expectZeros(view, at + 6, at + 8, "bytes 6 and 7 of a widget");
    expectZeros(view, at + 20, at + 24, "bytes 20 to 23 of a widget");
    const columns = [0, 1, 2].map((slot) => view.getUint32(at + 8 + slot * 4, true));
    widgets.push({ id, spec: widgetSpec(view.getUint16(at + 4, true), columns) });
  }
  return { seq: Number(seq), widgets };
}

/**
 * What a widget of the kind `kind` shows, with its `columns`: as many
 * column ids as it has, then `NO_COLUMN`.
 */
function widgetSpec(kind: number, columns: readonly number[]): WidgetSpec {
  const used = (name: string, count: number): ColumnId[] => {
    const ids = columns.slice(0, count).map(columnId);
    if (columns.slice(count).some((column) => column !== NO_COLUMN)) {
      throw defect(`a ${name} widget with more than ${String(count)} columns`);
    }
    return ids;
  };
  switch (kind) {
    case 1: {
      const [x, y, z] = used("scatter3d", 3);
      if (x === undefined || y === undefined || z === undefined) {
        throw defect("a 3D scatter widget without its three axes");
      }
      return { kind: "scatter3d", axes: [x, y, z] };
    }
    case 2: {
      const [latitude, longitude] = used("map", 2);
      if (latitude === undefined || longitude === undefined) {
        throw defect("a map widget without its two columns");
      }
      return { kind: "map", latitude, longitude };
    }
    case 3: {
      const [country] = used("countryMap", 1);
      if (country === undefined) {
        throw defect("a map of countries widget without its column");
      }
      return { kind: "countryMap", country };
    }
    case 4: {
      const [column] = used("histogram", 1);
      if (column === undefined) {
        throw defect("a histogram widget without its column");
      }
      return { kind: "histogram", column };
    }
    default:
      throw defect(`a kind of widget ${String(kind)}`);
  }
}
