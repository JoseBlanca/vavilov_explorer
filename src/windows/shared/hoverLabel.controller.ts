import { render } from "lit-html";

import type { Connection } from "../../backend/connection.ts";
import { at } from "../../state/at.ts";
import { defect } from "../../state/defect.ts";
import type { TableDescription } from "../../state/description.ts";
import { hoverLabel, labelColumns } from "../../state/hoverLabel.ts";
import type { HoverLabel } from "../../state/hoverLabel.ts";
import type { RowIndex } from "../../state/ids.ts";
import { besidePointer } from "./besidePointer.ts";
import { hoverLabelView } from "./hoverLabel.view.ts";

/** The label of the individual under the pointer, in its element. */
export interface HoverLabelComponent {
  /** Shows the label of `row` beside `place`, in CSS pixels of the window. */
  readonly show: (row: RowIndex, place: { x: number; y: number }) => void;
  /** Fetches the label shown again, after a change of the table, the groups or the active classification. */
  readonly refresh: () => void;
  /** Hides the label. */
  readonly hide: () => void;
  /** Empties the element. */
  readonly destroy: () => void;
}

/**
 * The label in `element`: it fetches the row under the pointer with the
 * columns the label shows, from the description `described` gives, or none
 * while it is behind the window's copy, and draws the label of the latest
 * row asked for, beside the pointer and kept inside the window, and fetches
 * it again when told the row may have changed. Its row and place are the
 * component's own; a failure goes to `report`.
 */
export function createHoverLabel(
  element: HTMLElement,
  connection: Connection,
  described: () => TableDescription | null,
  decimalMark: string,
  report: (error: unknown) => void,
): HoverLabelComponent {
  let shown: { row: RowIndex; label: HoverLabel | null; place: { x: number; y: number } } | null =
    null;

  const draw = (): void => {
    const label = shown?.label ?? null;
    const place = shown?.place ?? { x: 0, y: 0 };
    render(hoverLabelView({ label, x: place.x, y: place.y }), element);
    const box = element.firstElementChild;
    if (label === null || !(box instanceof HTMLElement)) {
      return;
    }
    const { width, height } = box.getBoundingClientRect();
    const beside = besidePointer(place, width, height, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    render(hoverLabelView({ label, x: beside.x, y: beside.y }), element);
  };

  // Each fetch is told from a later one, which can be of the same row.
  let asked = 0;

  const fetchLabel = async (row: RowIndex): Promise<void> => {
    asked += 1;
    const ask = asked;
    const description = described();
    if (description === null) {
      return;
    }
    const active = connection.state.active()?.column ?? null;
    const columns = labelColumns(description, active).map((column) => column.id);
    const answer = await connection.fetchRow(row, columns);
    if (!answer.ok) {
      throw defect(`the row of a label refused as ${answer.error.kind}`);
    }
    if (ask !== asked || shown?.row !== row) {
      return;
    }
    if (answer.value === "stale" || described() !== description) {
      return;
    }
    const codes = active === null ? null : connection.state.codes(active);
    const group = codes === null ? null : at(codes, row);
    shown = { ...shown, label: hoverLabel(description, active, group, answer.value, decimalMark) };
    draw();
  };

  return {
    show: (row, place) => {
      if (shown?.row === row) {
        shown = { ...shown, place };
        draw();
        return;
      }
      shown = { row, label: null, place };
      draw();
      fetchLabel(row).catch(report);
    },
    refresh: () => {
      if (shown !== null) {
        fetchLabel(shown.row).catch(report);
      }
    },
    hide: () => {
      shown = null;
      draw();
    },
    destroy: () => {
      shown = null;
      draw();
    },
  };
}
