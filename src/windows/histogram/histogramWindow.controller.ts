import { connect } from "../../backend/connection.ts";
import type { Click } from "../../state/pointClick.ts";
import { tauriTransport } from "../../backend/transport.ts";
import { numberText } from "../../state/cellText.ts";
import type { ColumnNumbers } from "../../state/columnNumbers.ts";
import { defect } from "../../state/defect.ts";
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
import { placedRows, placedText } from "../../state/placed.ts";
import type { Placed } from "../../state/placed.ts";
import { countRows, selectionAfterClick } from "../../state/rowSet.ts";
import type { SelectedGroups } from "../../state/selectedGroups.ts";
import { createHistogram } from "../../plots/histogram.ts";
import { answered } from "../shared/answered.ts";
import { createDescribedTable } from "../shared/describedTable.ts";
import { createFetchedColumns } from "../shared/fetchedColumns.ts";
import { installSelectionKeys } from "../shared/selectionKeys.ts";
import { createGroupsPanel } from "../shared/groupsPanel.controller.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { countText } from "../shared/numbers.ts";
import { startPlotFrame } from "../shared/plotWindow.controller.ts";
import { slot } from "../shared/slot.ts";
import { createTextLabel } from "../shared/textLabel.controller.ts";

/**
 * What the window last drew: the rows it places, its bins, the codes and
 * the groups selected of the active classification, and its bars.
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
 * Starts the window of a histogram in `root`: the frame, the bar of a
 * defect, the connection to the backend, the column, fetched again
 * whenever it changes, and its bars stacked by the groups of the active
 * classification, drawn from the window's copy of the state. The pointer
 * over a segment shows its label; a click on a segment selects its
 * individuals, or none when they were the selection, Cmd-click or
 * Ctrl-click adds them to the selection or, when all are selected, takes
 * them away, and Shift-click selects the same
 * segment of every bin from the one last clicked. Its groups panel offers
 * the classification, the groups and + and − (docs/design.md, section
 * 2.2). The window is named after its column, "Histogram of height". The
 * backend closes it when a load or a change of role leaves the column no
 * number.
 */
export async function startHistogramWindow(root: HTMLElement): Promise<void> {
  const defectBar = startPlotFrame(root, "Histogram", { legend: false, webGl: false });
  if (defectBar === null) {
    return;
  }
  try {
    const connection = await connect(tauriTransport(), defectBar.show);
    const { state } = connection;
    const spec = await connection.describeWidget();
    if (spec.kind !== "histogram") {
      throw defect(`a histogram's window for a widget of the kind ${spec.kind}`);
    }
    const { column } = spec;
    const decimalMark = await connection.regionDecimalMark();
    const table = createDescribedTable(connection);
    const label = createTextLabel(slot(root, "label"));
    let drawn: Drawn | null = null;
    /** The name of the column, as the table has it now. */
    let columnName = "";
    /** The segment last clicked without Shift, where a Shift-click's run starts. */
    let anchor: { readonly bin: number; readonly part: Part } | null = null;
    /** The segment under the pointer, by its place in the bars, and where the pointer is. */
    let hovered: { segment: number; place: { x: number; y: number } } | null = null;

    const infoBar = createInfoBar(
      slot(root, "info"),
      state,
      {
        aspects: [],
        text: () => (drawn === null ? null : placedText(drawn.placed, countText, "no value")),
      },
      () => {
        plot.focus();
      },
    );

    /** A value of an edge or of the axis, with the decimal mark of the system's region. */
    const valueText = (value: number): string => numberText(value, decimalMark);

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
     * they were the selection; or, with a toggle, adds them to the selection, or takes them away when all of
     * them are in it; or, with a range, selects those of the same part in
     * every bin from the anchor's. A segment holds at least one individual.
     */
    const select = (index: number, click: Click): void => {
      const now = state.selection();
      if (drawn === null || now === null) {
        return;
      }
      const segment = drawn.stack.segments[index];
      if (segment === undefined) {
        throw defect(
          `a click on segment ${String(index)} of ${String(drawn.stack.segments.length)}`,
        );
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
      connection.setSelection(bits).then(answered("selecting", draw)).catch(defectBar.show);
    };

    const plot = createHistogram(slot(root, "plot"), {
      onHover: (segment, place) => {
        hovered = segment === null || place === null ? null : { segment, place };
        showLabel();
      },
      onClick: select,
    });

    // Escape hides the label beside the pointer, which may cover the groups
    // panel, until the pointer moves (decided by the owner on 4 October
    // 2026); the key goes on to release + or −, or clear the selection.
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        plot.forgetPointer();
      }
    });

    const columns = createFetchedColumns(connection, [column], () => {
      draw();
    });

    const draw = (): void => {
      const current = columns.current()?.[0];
      const project = state.project();
      const now = table.current();
      if (current === undefined || project.kind === "noProject" || now === null) {
        return;
      }
      const same = drawn?.from === current;
      const placed = same && drawn !== null ? drawn.placed : placedRows([current], project.numRows);
      const bins = same && drawn !== null ? drawn.bins : binsOf(current, placed, STARTING_BINS);
      const active = state.active();
      const codes = active === null ? null : state.codes(active.column);
      const rows = codes === null ? [] : groupsModel(now, active, state.codes, decimalMark).rows;
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
        name: document.title,
        columnName,
        lowest: bins.lowest,
        highest: bins.highest,
        numBins: bins.count,
        segments: stack.segments,
        tallest: stack.tallest,
        valueText,
        countText,
      });
      infoBar.recount();
      showLabel();
    };

    const describe = async (): Promise<void> => {
      const described = await table.fetch();
      const name = described.columns.find((each) => each.id === column)?.name;
      if (name === undefined) {
        throw defect(`a histogram of column ${String(column)}, not in the table`);
      }
      columnName = name;
      document.title = `Histogram of ${name}`;
      draw();
      groups.redraw();
    };

    state.subscribe("table", () => {
      describe().catch(defectBar.show);
      columns.refresh().catch(defectBar.show);
    });
    // The classification holds the groups selected, which the bars are
    // stacked by.
    for (const aspect of ["codes", "selection", "classification"] as const) {
      state.subscribe(aspect, draw);
    }
    const groups = createGroupsPanel(
      slot(root, "panel"),
      connection,
      table.now,
      decimalMark,
      infoBar.tell,
      defectBar.show,
      "assigning",
    );
    // After the panel's, which releases + or − first.
    installSelectionKeys(window, connection, defectBar.show);
    if (import.meta.env.DEV) {
      // For the e2e tests alone, which click a segment where it is drawn;
      // a build for users has no such name.
      Reflect.set(globalThis, "__vavilovPlot", plot);
    }
    await describe();
    await columns.refresh();
  } catch (error: unknown) {
    defectBar.show(error);
  }
}
