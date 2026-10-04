import { connect } from "../../backend/connection.ts";
import type { Connection } from "../../backend/connection.ts";
import { tauriTransport } from "../../backend/transport.ts";
import { numberText } from "../../state/cellText.ts";
import type { ColumnNumbers } from "../../state/columnNumbers.ts";
import { defect } from "../../state/defect.ts";
import { isCategoricalColumn } from "../../state/description.ts";
import type { TableDescription } from "../../state/description.ts";
import { isRowIndex } from "../../state/ids.ts";
import type { ColumnId, RowIndex } from "../../state/ids.ts";
import type { EditMode } from "../../state/message.ts";
import { placedRows, placedText } from "../../state/placed.ts";
import type { Placed } from "../../state/placed.ts";
import { pointStyle, rgbOf } from "../../state/pointStyle.ts";
import type { PointStyle } from "../../state/pointStyle.ts";
import { onlyRow, toggledRow } from "../../state/rowSet.ts";
import { singleOf } from "../../state/selectedGroups.ts";
import type { WidgetSpec } from "../../state/widget.ts";
import type { LassoState, PointViewEvents } from "../../plots/pointView.ts";
import { answered } from "./answered.ts";
import { createFetchedColumns } from "./fetchedColumns.ts";
import { createDescribedTable } from "./describedTable.ts";
import { createGroupsPanel } from "./groupsPanel.controller.ts";
import type { PanelTools } from "./groupsPanel.view.ts";
import { createHoverLabel } from "./hoverLabel.controller.ts";
import { createInfoBar } from "./infoBar.controller.ts";
import { countText } from "./numbers.ts";
import { startPlotFrame } from "./plotWindow.controller.ts";
import { slot } from "./slot.ts";

/** What a point window gives its plot to draw. */
export interface PointPlotData {
  /** The values of the window's columns, in the order of {@link PointWindowKind.columns}. */
  readonly columns: readonly ColumnNumbers[];
  /** The names of those columns, in the same order. */
  readonly titles: readonly string[];
  /** The rows it draws, those with a value it can draw in every column. */
  readonly placed: Placed;
  /** The name of the plot, which a screen reader reads, the window's title. */
  readonly name: string;
  /** The colour, size, shape and mark of every point. */
  readonly style: PointStyle;
  /** The lasso: off, armed by + or −, or drawn and waiting for Enter. */
  readonly lasso: LassoState;
}

/** The plot of a point window, a 3D scatter or a map of the individuals. */
export interface PointPlot {
  /** Draws `data`. */
  readonly update: (data: PointPlotData) => void;
  /** The place of a row's point in CSS pixels of the window, or `null` when it is not drawn. */
  readonly placeOf: (row: number) => { x: number; y: number } | null;
  /**
   * For a map, the place of a latitude and a longitude in CSS pixels of the
   * window, by which the tests find a place on it; `null` for a 3D scatter.
   */
  readonly placeOfDegrees:
    ((latitude: number, longitude: number) => { x: number; y: number }) | null;
  /** Gives the plot the keyboard's focus. */
  readonly focus: () => void;
}

/** What a kind of point window is, from what its widget shows. */
export interface PointWindowKind {
  /** The columns it draws, in the order its plot takes them. */
  readonly columns: readonly ColumnId[];
  /** The window's title, from the names of its columns. */
  readonly title: (names: readonly string[]) => string;
  /** What the individuals it leaves out lack, as its information bar says it. */
  readonly lacking: string;
  /** The tools of its groups panel. */
  readonly tools: PanelTools;
  /**
   * Makes its plot in `element`, with `events` and `tickText`, which writes
   * a value with the decimal mark of the system's region.
   */
  readonly createPlot: (
    element: HTMLElement,
    events: PointViewEvents,
    tickText: (value: number) => string,
  ) => PointPlot;
}

/** The rows of a lasso drawn and released, waiting for Enter, and the button it was drawn with. */
interface WaitingLasso {
  readonly rows: Uint8Array;
  readonly mode: EditMode;
}

/**
 * Starts the window of a point view in `root`, a 3D scatter or a map of the
 * individuals, of the kind `kindOf` gives for the window's widget, titled
 * `untitled` until it knows its columns: the frame, the bar of a defect, the
 * connection to the backend, the columns, fetched again whenever one
 * changes, and the plot of them, drawn from the window's copy of the
 * state. A click on a point selects its individual, Cmd-click or
 * Ctrl-click adds it to the selection or takes it away; the pointer over a
 * point makes it the hover, and shows its label; while + or − is pressed,
 * in any window, a drag draws a lasso, which Enter applies and Escape drops
 * (docs/design.md, section 2.2). The backend closes the window when a load
 * or a change of role leaves it a column it cannot show.
 */
export async function startPointWindow(
  root: HTMLElement,
  untitled: string,
  kindOf: (spec: WidgetSpec) => PointWindowKind,
): Promise<void> {
  const defectBar = startPlotFrame(root, untitled, false);
  if (defectBar === null) {
    return;
  }
  try {
    const connection = await connect(tauriTransport(), defectBar.show);
    const { state } = connection;
    const kind = kindOf(await connection.describeWidget());
    const decimalMark = await connection.regionDecimalMark();
    const table = createDescribedTable(connection);
    let lasso: WaitingLasso | null = null;
    let placed: { from: readonly ColumnNumbers[]; placed: Placed } | null = null;
    const infoBar = createInfoBar(
      slot(root, "info"),
      state,
      {
        // How many individuals the plot draws, counted as it draws.
        aspects: [],
        text: () => (placed === null ? null : placedText(placed.placed, countText, kind.lacking)),
      },
      () => {
        plot.focus();
      },
    );

    const label = createHoverLabel(
      slot(root, "label"),
      connection,
      table.current,
      decimalMark,
      defectBar.show,
    );
    const hover = createHoverSender(connection, defectBar.show);

    const dropLasso = (): void => {
      if (lasso !== null) {
        lasso = null;
        draw();
      }
    };

    const applyLasso = (): void => {
      const waiting = lasso;
      const active = state.active();
      lasso = null;
      draw();
      if (waiting === null || active?.mode !== waiting.mode) {
        return;
      }
      const target = singleOf(active.selected);
      const sent =
        waiting.mode === "add"
          ? target === null
            ? Promise.reject(defect("+ pressed with no one row selected"))
            : connection.assignRows(active.column, target, waiting.rows)
          : connection.unassignRows(active.column, active.selected, waiting.rows);
      sent.then(answered("applying the lasso", draw)).catch(defectBar.show);
    };

    const select = (point: number, click: "select" | "toggle"): void => {
      const row = rowOf(point);
      const now = state.selection();
      const project = state.project();
      if (now === null || project.kind === "noProject") {
        return;
      }
      // A click selects the individual alone; a toggle adds it to the
      // selection, or takes it away when it was in it.
      const bits = click === "toggle" ? toggledRow(now, row) : onlyRow(project.numRows, row);
      connection.setSelection(bits).then(answered("selecting", draw)).catch(defectBar.show);
    };

    const plot = kind.createPlot(
      slot(root, "plot"),
      {
        onHover: (point, place) => {
          const row = point === null ? null : rowOf(point);
          hover.send(row);
          if (row === null || place === null) {
            label.hide();
          } else {
            label.show(row, place);
          }
        },
        onClick: select,
        onLasso: (rows) => {
          const mode = state.active()?.mode ?? null;
          if (mode !== null) {
            lasso = { rows, mode };
            draw();
          }
        },
        onLassoDropped: dropLasso,
        // The colours of the points with no group come from the theme.
        onThemeChange: () => {
          draw();
        },
      },
      (value) => numberText(value, decimalMark),
    );

    const columns = createFetchedColumns(connection, kind.columns, () => {
      draw();
    });

    const draw = (): void => {
      const current = columns.current();
      const project = state.project();
      const now = table.current();
      if (current === null || project.kind === "noProject" || now === null) {
        return;
      }
      const samePlaced = placed?.from.every((column, index) => column === current[index]) ?? false;
      if (placed === null || !samePlaced) {
        placed = { from: current, placed: placedRows(current, project.numRows) };
      }
      const active = state.active();
      const mode = active?.mode ?? null;
      const classification =
        active === null ? undefined : now.columns.find((column) => column.id === active.column);
      if (classification !== undefined && !isCategoricalColumn(classification)) {
        throw defect(`an active classification ${String(classification.id)} that is no category`);
      }
      const tokens = getComputedStyle(root);
      const token = (name: string): string => tokens.getPropertyValue(name).trim();
      const style = pointStyle({
        numRows: project.numRows,
        codes: active === null ? null : state.codes(active.column),
        groupColours: classification?.levels.map((level) => rgbOf(level.colour)) ?? [],
        unassigned: rgbOf(token("--color-point-unassigned")),
        unclassified: rgbOf(token("--color-point")),
        selected: active?.selected ?? [],
        selection: state.selection(),
        hover: state.hover(),
        lasso,
      });
      const titles = titlesOf(now, kind.columns);
      plot.update({
        columns: current,
        titles,
        placed: placed.placed,
        name: kind.title(titles),
        style,
        lasso:
          mode === null ? { kind: "off" } : { kind: lasso === null ? "armed" : "waiting", mode },
      });
      infoBar.recount();
    };

    const describe = async (): Promise<void> => {
      const described = await table.fetch();
      document.title = kind.title(titlesOf(described, kind.columns));
      draw();
      label.refresh();
      groups.redraw();
    };

    state.subscribe("table", () => {
      describe().catch(defectBar.show);
      columns.refresh().catch(defectBar.show);
    });
    // The label's values come with the description, fetched again above.
    for (const aspect of ["codes", "classification"] as const) {
      state.subscribe(aspect, label.refresh);
    }
    state.subscribe("classification", () => {
      // A lasso waits for the button it was drawn with.
      if (lasso !== null && state.active()?.mode !== lasso.mode) {
        lasso = null;
      }
      draw();
    });
    for (const aspect of ["codes", "selection", "hover"] as const) {
      state.subscribe(aspect, draw);
    }
    window.addEventListener("keydown", (event) => {
      if (lasso === null) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        applyLasso();
      } else if (event.key === "Escape") {
        event.preventDefault();
        dropLasso();
      }
    });
    // After the keys of the lasso, so that Escape drops a waiting lasso
    // before it releases + or − (docs/design.md, section 2.2).
    const groups = createGroupsPanel(
      slot(root, "panel"),
      connection,
      table.now,
      decimalMark,
      infoBar.tell,
      defectBar.show,
      kind.tools,
    );
    if (import.meta.env.DEV) {
      // For the e2e tests alone, which find a point where it is drawn; a
      // build for users has no such name.
      Reflect.set(globalThis, "__vavilovPlot", plot);
    }
    await describe();
    await columns.refresh();
  } catch (error: unknown) {
    defectBar.show(error);
  }
}

/** The row of a point of the plot, whose points are the rows of the table. */
function rowOf(point: number): RowIndex {
  if (!isRowIndex(point)) {
    throw defect(`a point ${String(point)} that is no row`);
  }
  return point;
}

/** The names of `columns`, in their order. */
function titlesOf(description: TableDescription, columns: readonly ColumnId[]): readonly string[] {
  return columns.map((id) => {
    const name = description.columns.find((column) => column.id === id)?.name;
    if (name === undefined) {
      throw defect(`a plot of columns ${columns.join(", ")}, not all in the table`);
    }
    return name;
  });
}

/** The hover this window sends: at most one per frame, and only a change. */
interface HoverSender {
  /** Sends `row` as the hover on the next frame, unless it is the last sent. */
  readonly send: (row: RowIndex | null) => void;
}

function createHoverSender(connection: Connection, report: (error: unknown) => void): HoverSender {
  let sent: RowIndex | null = null;
  let waiting: { row: RowIndex | null } | null = null;
  return {
    send: (row) => {
      if (waiting === null && row === sent) {
        return;
      }
      if (waiting !== null) {
        waiting.row = row;
        return;
      }
      waiting = { row };
      requestAnimationFrame(() => {
        const next = waiting?.row ?? null;
        waiting = null;
        if (next === sent) {
          return;
        }
        sent = next;
        connection
          .setHover(next)
          .then(answered("the hover", () => undefined))
          .catch(report);
      });
    },
  };
}
