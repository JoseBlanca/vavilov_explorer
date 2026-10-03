import { render } from "lit-html";

import { connect } from "../../backend/connection.ts";
import type { Connection } from "../../backend/connection.ts";
import { tauriTransport } from "../../backend/transport.ts";
import { numberText } from "../../state/cellText.ts";
import type { ColumnNumbers } from "../../state/columnNumbers.ts";
import { defect } from "../../state/defect.ts";
import { isCategoricalColumn } from "../../state/description.ts";
import type { DescriptionNow, TableDescription } from "../../state/description.ts";
import { isRowIndex } from "../../state/ids.ts";
import type { RowIndex } from "../../state/ids.ts";
import type { EditMode } from "../../state/message.ts";
import { placedRows, placedText } from "../../state/placed.ts";
import type { Placed } from "../../state/placed.ts";
import { pointStyle, rgbOf } from "../../state/pointStyle.ts";
import { onlyRow, toggledRow } from "../../state/rowSet.ts";
import { singleOf } from "../../state/selectedGroups.ts";
import type { Axes } from "../../state/widget.ts";
import { NO_WEBGL_WORDS } from "../../state/widgetMessages.ts";
import { createScatter3d } from "../../plots/scatter3d.ts";
import type { Scatter3d } from "../../plots/scatter3d.ts";
import { answered } from "../shared/answered.ts";
import { createDefectBar } from "../shared/defectBar.controller.ts";
import { countText } from "../shared/numbers.ts";
import { createGroupsPanel } from "../shared/groupsPanel.controller.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { slot } from "../shared/slot.ts";
import { canDrawWebGl } from "../shared/webgl.ts";
import { createAxisColumns } from "./axisColumns.ts";
import { createHoverLabel } from "./hoverLabel.controller.ts";
import { scatter3dWindowView } from "./scatter3dWindow.view.ts";

/** The rows of a lasso drawn and released, waiting for Enter, and the button it was drawn with. */
interface WaitingLasso {
  readonly rows: Uint8Array;
  readonly mode: EditMode;
}

/**
 * Starts the window of a 3D scatter in `root`: the frame, the bar of a
 * defect, the connection to the backend, what its widget shows, its columns,
 * fetched again whenever one changes, and the plot of them, drawn from the
 * window's copy of the state. A click on a point selects its individual,
 * Cmd-click or Ctrl-click adds it to the selection or takes it away; the
 * pointer over a point makes it the hover, and shows its label; while + or −
 * is pressed a drag draws a lasso, which Enter applies and Escape drops
 * (docs/design.md, section 2.2). The window is named after its columns. The
 * backend closes it when a load or a change of role leaves an axis without
 * a column of numbers.
 */
export async function startScatter3dWindow(root: HTMLElement): Promise<void> {
  if (!canDrawWebGl()) {
    // The main window could draw, as it checks before it opens one; this
    // one cannot, as when the graphics card refuses one more drawing.
    document.title = "3D scatter";
    render(scatter3dWindowView({ cannotDraw: NO_WEBGL_WORDS, groups: null }), root);
    return;
  }
  // Whether the groups panel is shown is this window's own, and starts shown.
  let groupsShown = true;
  const drawFrame = (): void => {
    render(
      scatter3dWindowView({
        cannotDraw: null,
        groups: {
          shown: groupsShown,
          onToggle: () => {
            groupsShown = !groupsShown;
            drawFrame();
          },
        },
      }),
      root,
    );
  };
  drawFrame();
  const defectBar = createDefectBar(slot(root, "defect"), window);
  try {
    const connection = await connect(tauriTransport(), defectBar.show);
    const { state } = connection;
    const spec = await connection.describeWidget();
    const decimalMark = await connection.regionDecimalMark();
    let description: TableDescription | null = null;
    let lasso: WaitingLasso | null = null;
    let placed: { from: readonly ColumnNumbers[]; placed: Placed } | null = null;
    const infoBar = createInfoBar(
      slot(root, "info"),
      state,
      {
        // How many individuals the plot draws, counted as it draws.
        aspects: [],
        text: () => (placed === null ? null : placedText(placed.placed, countText)),
      },
      () => {
        plot.focus();
      },
    );

    /** The description, when it is that of the copy's load and shape. */
    const described = (): TableDescription | null => {
      const project = state.project();
      if (
        project.kind === "noProject" ||
        description?.loadedAt !== project.loadedAt ||
        description.shapeAt !== state.shapeAt()
      ) {
        return null;
      }
      return description;
    };

    /** The description as the groups panel takes it. */
    const describedNow = (): DescriptionNow => {
      if (state.project().kind === "noProject") {
        return { kind: "none" };
      }
      const now = described();
      return now === null ? { kind: "behind" } : { kind: "current", description: now };
    };

    const label = createHoverLabel(
      slot(root, "label"),
      connection,
      described,
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

    const plot: Scatter3d = createScatter3d(
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

    const columns = createAxisColumns(connection, spec.axes, () => {
      draw();
    });

    const draw = (): void => {
      const current = columns.current();
      const project = state.project();
      const now = described();
      if (current === null || project.kind === "noProject" || now === null) {
        return;
      }
      const samePlaced = placed?.from.every((axis, index) => axis === current[index]) ?? false;
      if (placed === null || !samePlaced) {
        placed = { from: current, placed: placedRows(current, project.numRows) };
      }
      const [x, y, z] = current;
      if (x === undefined || y === undefined || z === undefined) {
        throw defect("a 3D scatter with fewer than three axes");
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
      plot.update({
        values: [x.values, y.values, z.values],
        centres: [x.centre, y.centre, z.centre],
        placed: placed.placed,
        name: scatter3dTitle(now, spec.axes),
        titles: titlesOf(now, spec.axes),
        style,
        lasso:
          mode === null ? { kind: "off" } : { kind: lasso === null ? "armed" : "waiting", mode },
      });
      infoBar.recount();
    };

    const describe = async (): Promise<void> => {
      const answer = await connection.describeTable();
      if (!answer.ok) {
        throw defect(`a 3D scatter with no table to describe: ${answer.error.kind}`);
      }
      description = answer.value;
      document.title = scatter3dTitle(answer.value, spec.axes);
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
      describedNow,
      decimalMark,
      infoBar.tell,
      defectBar.show,
    );
    if (import.meta.env.DEV) {
      // For the e2e tests alone, which find a point where it is drawn; a
      // build for users has no such name.
      Reflect.set(globalThis, "__vavilovScatter3d", { placeOf: plot.placeOf });
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

/** The names of the columns of the axes. */
function titlesOf(description: TableDescription, axes: Axes): readonly [string, string, string] {
  const [x, y, z] = axes.map(
    (axis) => description.columns.find((column) => column.id === axis)?.name,
  );
  if (x === undefined || y === undefined || z === undefined) {
    throw defect(`a 3D scatter of columns ${axes.join(", ")}, not all in the table`);
  }
  return [x, y, z];
}

/** The title of a 3D scatter's window, which names its axes' columns. */
function scatter3dTitle(description: TableDescription, axes: Axes): string {
  const [x, y, z] = titlesOf(description, axes);
  return `3D scatter of ${x}, ${y} and ${z}`;
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
