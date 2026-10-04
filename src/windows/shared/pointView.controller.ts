import type { Connection } from "../../backend/connection.ts";
import type { Click } from "../../state/pointClick.ts";
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
import { onlyRow, selectionAfterClick, toggledRow } from "../../state/rowSet.ts";
import { singleOf } from "../../state/selectedGroups.ts";
import type { LassoState, PointViewEvents } from "../../plots/pointerInput.ts";
import { answered } from "./answered.ts";
import type { DescribedTable } from "./describedTable.ts";
import { createFetchedColumns } from "./fetchedColumns.ts";
import type { PanelTools } from "./groupsPanel.view.ts";
import type { HoverLabelComponent } from "./hoverLabel.controller.ts";
import { countText } from "./numbers.ts";

/** What a point view gives its plot to draw. */
export interface PointPlotData {
  /** The values of the view's columns, in the order of {@link PointViewKind.columns}. */
  readonly columns: readonly ColumnNumbers[];
  /** The names of those columns, in the same order. */
  readonly titles: readonly string[];
  /** The rows it draws, those with a value it can draw in every column. */
  readonly placed: Placed;
  /** The name of the plot, which a screen reader reads. */
  readonly name: string;
  /** The colour, size, shape and mark of every point. */
  readonly style: PointStyle;
  /** The row under the pointer, in this window or another, or `null`. */
  readonly hover: number | null;
  /** The lasso: off, armed by + or −, or drawn and waiting for Enter. */
  readonly lasso: LassoState;
}

/** The plot of a point view, a 3D scatter, a map of the individuals or a 2D scatter. */
export interface PointPlot {
  /** Draws `data`. */
  readonly update: (data: PointPlotData) => void;
  /** The place of a row's point in CSS pixels of the window, or `null` when it is not drawn. */
  readonly placeOf: (row: number) => { x: number; y: number } | null;
  /**
   * For a map, the place of a latitude and a longitude in CSS pixels of the
   * window, by which the tests find a place on it; `null` for a scatter.
   */
  readonly placeOfDegrees:
    ((latitude: number, longitude: number) => { x: number; y: number }) | null;
  /** Gives the plot the keyboard's focus. */
  readonly focus: () => void;
  /**
   * Leaves the element as it found it, and gives a drawing with WebGL back
   * to the graphics card.
   */
  readonly destroy: () => void;
}

/** What a kind of point view is, from what its widget shows. */
export interface PointViewKind {
  /** The columns it draws, in the order its plot takes them. */
  readonly columns: readonly ColumnId[];
  /** Its name, from the names of its columns, "Map of lat and lon". */
  readonly title: (names: readonly string[]) => string;
  /** What the individuals it leaves out lack, as its count says it. */
  readonly lacking: string;
  /** The tools of its window's groups panel. */
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

/** What a point view shares with its window. */
export interface PointViewContext {
  /** The window's connection to the backend, and its copy of the state. */
  readonly connection: Connection;
  /** The description of the table, which the window asks for again as it changes. */
  readonly table: DescribedTable;
  /** The decimal mark of the system's region. */
  readonly decimalMark: string;
  /** The window's label of the individual under the pointer. */
  readonly hoverLabel: HoverLabelComponent;
  /** The window's sender of the hover. */
  readonly hover: HoverSender;
  /** Shows a defect in the window's bar. */
  readonly report: (error: unknown) => void;
  /** The element whose tokens give the colours of the points with no group. */
  readonly tokens: HTMLElement;
  /** Its lasso was drawn and waits for Enter: the window drops one another view has waiting. */
  readonly onLassoWaiting: () => void;
  /** It drew again, and so may count other individuals. */
  readonly onDrawn: () => void;
}

/** A point view in its element. */
export interface PointView {
  /** How many individuals it draws, in words, or `null` before it draws. */
  readonly count: () => string | null;
  /** Draws again, once the window has a newer description of the table. */
  readonly described: () => void;
  /** Whether a lasso drawn in it waits for Enter. */
  readonly lassoWaiting: () => boolean;
  /** Applies the lasso waiting, Enter. */
  readonly applyLasso: () => void;
  /** Drops the lasso waiting, Escape, or a lasso drawn in another view. */
  readonly dropLasso: () => void;
  /** Gives the plot the keyboard's focus. */
  readonly focus: () => void;
  /** The plot, for the e2e tests alone. */
  readonly plot: PointPlot;
  /** Unsubscribes and destroys the plot. */
  readonly destroy: () => void;
}

/** The rows of a lasso drawn and released, waiting for Enter, and the button it was drawn with. */
interface WaitingLasso {
  readonly rows: Uint8Array;
  readonly mode: EditMode;
}

/**
 * Draws a point view of the kind `kind` in `element`, a 3D scatter, a map
 * of the individuals or a 2D scatter: its columns, fetched again whenever one changes, and
 * the plot of them, drawn from the window's copy of the state. A click on a
 * point selects its individual, Cmd-click or Ctrl-click adds it to the
 * selection or takes it away; the pointer over a point makes it the hover,
 * and shows its label; while + or − is pressed, in any window, a drag draws
 * a lasso, which stays in the view and waits for Enter (docs/design.md,
 * section 2.2).
 */
export function createPointView(
  element: HTMLElement,
  kind: PointViewKind,
  context: PointViewContext,
): PointView {
  const { connection, table, report } = context;
  const { state } = connection;
  let lasso: WaitingLasso | null = null;
  let placed: { from: readonly ColumnNumbers[]; placed: Placed } | null = null;
  /** Whether the view was destroyed: a column that arrives after is not drawn. */
  let destroyed = false;
  /** Whether the pointer is over a point, whose hover and label the view set. */
  let hovering = false;

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
    sent.then(answered("applying the lasso", draw)).catch(report);
  };

  const select = (point: number, click: Exclude<Click, "range">): void => {
    const row = rowOf(point);
    const now = state.selection();
    const project = state.project();
    if (now === null || project.kind === "noProject") {
      return;
    }
    // A click selects the individual alone, or none when it was the one
    // selected; a toggle adds it to the selection, or takes it away when
    // it was in it.
    const bits =
      click === "toggle"
        ? toggledRow(now, row)
        : selectionAfterClick(now, onlyRow(project.numRows, row), "select");
    connection.setSelection(bits).then(answered("selecting", draw)).catch(report);
  };

  const plot = kind.createPlot(
    element,
    {
      onHover: (point, place) => {
        const row = point === null ? null : rowOf(point);
        hovering = row !== null;
        context.hover.send(row);
        if (row === null || place === null) {
          context.hoverLabel.hide();
        } else {
          context.hoverLabel.show(row, place);
        }
      },
      onClick: select,
      onLasso: (rows) => {
        const mode = state.active()?.mode ?? null;
        if (mode !== null) {
          context.onLassoWaiting();
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
    (value) => numberText(value, context.decimalMark),
  );

  const columns = createFetchedColumns(connection, kind.columns, () => {
    draw();
  });

  const draw = (): void => {
    const current = columns.current();
    const project = state.project();
    const now = table.current();
    if (destroyed || current === null || project.kind === "noProject" || now === null) {
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
    const tokens = getComputedStyle(context.tokens);
    const token = (name: string): string => tokens.getPropertyValue(name).trim();
    const hover = state.hover();
    const style = pointStyle({
      numRows: project.numRows,
      codes: active === null ? null : state.codes(active.column),
      groupColours: classification?.levels.map((level) => rgbOf(level.colour)) ?? [],
      unassigned: rgbOf(token("--color-point-unassigned")),
      unclassified: rgbOf(token("--color-point")),
      selected: active?.selected ?? [],
      selection: state.selection(),
      hover,
      lasso,
    });
    const titles = titlesOf(now, kind.columns);
    plot.update({
      columns: current,
      titles,
      placed: placed.placed,
      name: kind.title(titles),
      style,
      hover,
      lasso: mode === null ? { kind: "off" } : { kind: lasso === null ? "armed" : "waiting", mode },
    });
    context.onDrawn();
  };

  const unsubscribes = [
    state.subscribe("table", () => {
      columns.refresh().catch(report);
    }),
    state.subscribe("classification", () => {
      // A lasso waits for the button it was drawn with.
      if (lasso !== null && state.active()?.mode !== lasso.mode) {
        lasso = null;
      }
      draw();
    }),
    ...(["codes", "selection", "hover"] as const).map((aspect) => state.subscribe(aspect, draw)),
  ];
  columns.refresh().catch(report);

  return {
    count: () => (placed === null ? null : placedText(placed.placed, countText, kind.lacking)),
    described: draw,
    lassoWaiting: () => lasso !== null,
    applyLasso,
    dropLasso,
    focus: () => {
      plot.focus();
    },
    plot,
    destroy: () => {
      destroyed = true;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      // A view closed under the pointer, as a tile after a change of role,
      // gets no event that the pointer left it.
      if (hovering) {
        context.hover.send(null);
        context.hoverLabel.hide();
      }
      plot.destroy();
    },
  };
}

/** The row of a point of the plot, whose points are the rows of the table. */
function rowOf(point: number): RowIndex {
  if (!isRowIndex(point)) {
    throw defect(`a point ${String(point)} that is no row`);
  }
  return point;
}

/** The names of `columns`, in their order. */
export function titlesOf(
  description: TableDescription,
  columns: readonly ColumnId[],
): readonly string[] {
  return columns.map((id) => {
    const name = description.columns.find((column) => column.id === id)?.name;
    if (name === undefined) {
      throw defect(`a plot of columns ${columns.join(", ")}, not all in the table`);
    }
    return name;
  });
}

/** The hover a window sends: at most one per frame, and only a change. */
export interface HoverSender {
  /** Sends `row` as the hover on the next frame, unless it is the last sent. */
  readonly send: (row: RowIndex | null) => void;
}

/** The hover sender of a window's `connection`, which reports a failure to `report`. */
export function createHoverSender(
  connection: Connection,
  report: (error: unknown) => void,
): HoverSender {
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
