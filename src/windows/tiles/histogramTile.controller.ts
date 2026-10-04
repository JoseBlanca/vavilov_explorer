import { nothing, render } from "lit-html";

import type { Click } from "../../state/pointClick.ts";
import { numberText } from "../../state/cellText.ts";
import type { ColumnNumbers } from "../../state/columnNumbers.ts";
import { defect } from "../../state/defect.ts";
import { copyName } from "../../state/tileCopy.ts";
import { groupsModel } from "../../state/groups.ts";
import {
  STARTING_BINS,
  binsOf,
  edgesOf,
  roundedEdge,
  rowsOfPart,
  samePart,
  segmentText,
  stackOf,
} from "../../state/histogram.ts";
import type { Bins, Part, Stack } from "../../state/histogram.ts";
import type { Widget } from "../../state/widget.ts";
import { placedRows, placedText } from "../../state/placed.ts";
import type { Placed } from "../../state/placed.ts";
import { countRows, selectionAfterClick } from "../../state/rowSet.ts";
import type { SelectedGroups } from "../../state/selectedGroups.ts";
import { createHistogram } from "../../plots/histogram.ts";
import { answered } from "../shared/answered.ts";
import { createFetchedColumns } from "../shared/fetchedColumns.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { countText } from "../shared/numbers.ts";
import { slot } from "../shared/slot.ts";
import { plotTileView } from "./plotTile.view.ts";
import type { PlotTile, TileContext } from "./tile.ts";

/**
 * What the tile last drew: the rows it places, its bins, the codes and the
 * groups selected of the active classification, and its bars.
 */
interface Drawn {
  readonly from: ColumnNumbers;
  readonly placed: Placed;
  readonly bins: Bins;
  readonly codes: Uint16Array | null;
  readonly selected: SelectedGroups;
  readonly stack: Stack;
}

/** The colours of the parts that are no group, from the tokens (src/styles/tokens.css). */
const PART_COLOURS = {
  unassigned: "var(--color-point-unassigned)",
  others: "var(--color-other-groups)",
  unclassified: "var(--color-point)",
} as const;

/**
 * Draws the histogram of `widget` in its tile `element`, of the Plots window:
 * the title bar with its name, "Histogram of height", and the button that
 * asks `onClose` to close it; its column, fetched again whenever it
 * changes, and its bars stacked by the groups of the active classification;
 * and under them the count of the individuals it draws. The pointer over a
 * segment shows its label; a click on a segment selects its individuals, or
 * none when they were the selection, Cmd-click or Ctrl-click adds them to
 * the selection or, when all are selected, takes them away, and
 * Shift-click selects the same segment of every bin from the one last
 * clicked (docs/design.md, section 2.2).
 */
export function createHistogramTile(
  element: HTMLElement,
  widget: Widget,
  copy: number,
  context: TileContext,
  onClose: () => void,
): PlotTile {
  const { id, spec } = widget;
  if (spec.kind !== "histogram") {
    throw defect(`a histogram's tile for a widget of the kind ${spec.kind}`);
  }
  const { column } = spec;
  const { connection, label, report } = context;
  const { state } = connection;
  let drawn: Drawn | null = null;
  /** The name of the column, as the table has it now. */
  let columnName = "";
  /** The segment last clicked without Shift, where a Shift-click's run starts. */
  let anchor: { readonly bin: number; readonly part: Part } | null = null;
  /** The segment under the pointer, by its place in the bars, and where the pointer is. */
  let hovered: { segment: number; place: { x: number; y: number } } | null = null;
  /** Whether the tile was closed: a column that arrives after is not drawn. */
  let destroyed = false;

  const name = (): string =>
    columnName === "" ? "" : copyName(`Histogram of ${columnName}`, copy);
  const drawTile = (): void => {
    render(
      plotTileView({
        titleId: `tile-${String(id)}`,
        name: name(),
        onClose,
        legend: false,
        cannotDraw: null,
      }),
      element,
    );
  };
  drawTile();

  /** A value of an edge or of the axis, with the decimal mark of the system's region. */
  const valueText = (value: number): string => numberText(value, context.decimalMark);

  const showLabel = (): void => {
    const segment = hovered === null ? undefined : drawn?.stack.segments[hovered.segment];
    if (hovered === null || drawn === null || segment === undefined) {
      label.hide();
      return;
    }
    const { bins } = drawn;
    const width = (bins.highest - bins.lowest) / bins.count;
    const { low, high } = edgesOf(bins, segment.bin);
    label.show(
      segmentText(
        segment,
        valueText(roundedEdge(low, width)),
        valueText(roundedEdge(high, width)),
        countText,
      ),
      hovered.place,
    );
  };

  /**
   * Selects the individuals of the segment at `index` alone, or none when
   * they were the selection; or, with a toggle, adds them to the selection,
   * or takes them away when all of them are in it; or, with a range,
   * selects those of the same part in every bin from the anchor's. A
   * segment holds at least one individual.
   */
  const select = (index: number, click: Click): void => {
    const now = state.selection();
    if (drawn === null || now === null) {
      return;
    }
    const segment = drawn.stack.segments[index];
    if (segment === undefined) {
      throw defect(`a click on segment ${String(index)} of ${String(drawn.stack.segments.length)}`);
    }
    const from =
      click === "range" && anchor !== null && samePart(anchor.part, segment.part)
        ? anchor.bin
        : segment.bin;
    if (click !== "range") {
      anchor = { bin: segment.bin, part: segment.part };
    }
    const rows = rowsOfPart(
      drawn.bins,
      drawn.codes,
      drawn.selected,
      segment.part,
      from,
      segment.bin,
    );
    if (countRows(rows) === 0) {
      throw defect(`a click on segment ${String(index)}, which holds no individual`);
    }
    const bits = click === "range" ? rows : selectionAfterClick(now, rows, click);
    connection.setSelection(bits).then(answered("selecting", draw)).catch(report);
  };

  const plot = createHistogram(slot(element, "plot"), {
    onHover: (segment, place) => {
      const was = hovered;
      hovered = segment === null || place === null ? null : { segment, place };
      // The label is the window's: a tile the pointer did not leave keeps
      // its hands off another tile's.
      if (hovered !== null || was !== null) {
        showLabel();
      }
    },
    onClick: select,
  });

  const count = createInfoBar(
    slot(element, "count"),
    state,
    {
      aspects: [],
      text: () => (drawn === null ? null : placedText(drawn.placed, countText, "no value")),
    },
    () => {
      plot.focus();
    },
  );

  const columns = createFetchedColumns(connection, [column], () => {
    draw();
  });

  const draw = (): void => {
    if (destroyed) {
      return;
    }
    const current = columns.current()?.[0];
    const project = state.project();
    const now = context.table.current();
    if (current === undefined || project.kind === "noProject" || now === null) {
      return;
    }
    const same = drawn?.from === current;
    const placed = same && drawn !== null ? drawn.placed : placedRows([current], project.numRows);
    const bins = same && drawn !== null ? drawn.bins : binsOf(current, placed, STARTING_BINS);
    const active = state.active();
    const codes = active === null ? null : state.codes(active.column);
    const rows =
      codes === null ? [] : groupsModel(now, active, state.codes, context.decimalMark).rows;
    const stack = stackOf({
      bins,
      codes,
      rows,
      selection: state.selection(),
      colours: PART_COLOURS,
    });
    drawn = {
      from: current,
      placed,
      bins,
      codes,
      selected: codes === null ? [] : (active?.selected ?? []),
      stack,
    };
    plot.update({
      name: name(),
      columnName,
      lowest: bins.lowest,
      highest: bins.highest,
      numBins: bins.count,
      segments: stack.segments,
      tallest: stack.tallest,
      valueText,
      countText,
    });
    count.recount();
    if (hovered !== null) {
      showLabel();
    }
  };

  const unsubscribes = [
    state.subscribe("table", () => {
      columns.refresh().catch(report);
    }),
    // The classification holds the groups selected, which the bars are
    // stacked by.
    ...(["codes", "selection", "classification"] as const).map((aspect) =>
      state.subscribe(aspect, draw),
    ),
  ];
  columns.refresh().catch(report);

  return {
    described: (description) => {
      const found = description.columns.find((each) => each.id === column)?.name;
      if (found === undefined) {
        throw defect(`a histogram of column ${String(column)}, not in the table`);
      }
      columnName = found;
      drawTile();
      draw();
    },
    focus: () => {
      plot.focus();
    },
    forgetPointer: () => {
      plot.forgetPointer();
    },
    // A histogram draws no lasso.
    lassoWaiting: () => false,
    applyLasso: () => undefined,
    dropLasso: () => undefined,
    plot,
    destroy: () => {
      destroyed = true;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      if (hovered !== null) {
        label.hide();
      }
      count.destroy();
      plot.destroy();
      render(nothing, element);
    },
  };
}
