import { render } from "lit-html";

import { connect } from "../../backend/connection.ts";
import { tauriTransport } from "../../backend/transport.ts";
import { defect } from "../../state/defect.ts";
import type { WidgetId } from "../../state/ids.ts";
import { widgetFits } from "../../state/plotColumns.ts";
import { nextCopy } from "../../state/tileCopy.ts";
import type { OpenCopy } from "../../state/tileCopy.ts";
import { tileGrid } from "../../state/tileGrid.ts";
import type { Widget, WidgetKind } from "../../state/widget.ts";
import { closeWidget } from "../shared/closeWidget.ts";
import { createDefectBar } from "../shared/defectBar.controller.ts";
import { createDescribedTable } from "../shared/describedTable.ts";
import { createGroupsPanel } from "../shared/groupsPanel.controller.ts";
import { createHoverLabel } from "../shared/hoverLabel.controller.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { createHoverSender } from "../shared/pointView.controller.ts";
import { installSelectionKeys } from "../shared/selectionKeys.ts";
import { slot } from "../shared/slot.ts";
import { createTextLabel } from "../shared/textLabel.controller.ts";
import type { PlotTile, TileContext, TileMaker } from "./tile.ts";
import { tilesWindowView } from "./tilesWindow.view.ts";

/** A kind of window of tiles: its title, and the tile of each kind of widget it holds. */
export interface TilesWindowKind {
  /** The title of the window, which names it in the system's list of windows. */
  readonly title: string;
  /** The tile of each kind of widget the window holds; another kind is a defect. */
  readonly tiles: Partial<Readonly<Record<WidgetKind, TileMaker>>>;
}

/**
 * Starts a window of tiles in `root`, the Plots or the Maps window: the
 * frame, the bar of a defect, the connection to the backend, and a tile for
 * each of the window's widgets, made and closed as the app layer's list of
 * them changes and as the table can show them, and arranged by their
 * number; the groups panel, which offers the classification, the groups
 * and + and −, at the tiles' right or in the empty place of their last
 * row; the information bar of the window's messages; and the labels beside
 * the pointer (docs/design.md, section 2.2). The button of a tile asks the
 * app layer to forget its widget, and the app layer closes the window with
 * its last. A lasso drawn in a tile drops one waiting in another, so that
 * Enter applies one lasso and Escape drops it.
 */
export async function startTilesWindow(root: HTMLElement, kind: TilesWindowKind): Promise<void> {
  document.title = kind.title;
  // Whether the groups panel is shown is this window's own, and starts shown.
  let groupsShown = true;
  /** The widgets drawn, in their order. */
  let widgets: readonly Widget[] = [];
  const drawFrame = (): void => {
    render(
      tilesWindowView({
        tiles: widgets.map((widget) => widget.id),
        grid: tileGrid(widgets.length),
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
    const decimalMark = await connection.regionDecimalMark();
    const table = createDescribedTable(connection);
    const tiles = new Map<WidgetId, PlotTile>();
    /** What each tile shows, and its number among the copies of its plot, kept while it is open. */
    const copies = new Map<WidgetId, OpenCopy>();
    const hoverLabel = createHoverLabel(
      slot(root, "hoverLabel"),
      connection,
      table.current,
      decimalMark,
      defectBar.show,
    );
    const context: TileContext = {
      connection,
      table,
      decimalMark,
      label: createTextLabel(slot(root, "label")),
      hoverLabel,
      hover: createHoverSender(connection, defectBar.show),
      report: defectBar.show,
      // The bar is made below, before any answer comes back.
      tell: (message) => {
        infoBar.tell(message);
      },
      tokens: root,
      onLassoWaiting: (id) => {
        for (const [each, tile] of tiles) {
          if (each !== id) {
            tile.dropLasso();
          }
        }
      },
    };
    /** The tile whose button was pressed, and its place, so that the focus goes to the next. */
    let closing: { readonly id: WidgetId; readonly index: number } | null = null;
    /** The widgets the window asked to forget, since it cannot show them, asked once each. */
    const unfit = new Set<WidgetId>();

    // The window's messages alone: each tile counts what it draws.
    const infoBar = createInfoBar(
      slot(root, "info"),
      state,
      { aspects: [], text: () => null },
      () => {
        [...tiles.values()][0]?.focus();
      },
    );

    const close = (id: WidgetId): void => {
      closing = { id, index: widgets.findIndex((widget) => widget.id === id) };
      closeWidget(connection, id, defectBar.show);
    };

    /**
     * Makes a tile for each widget of the window's newest list that the
     * table can show and that has none, closes the tile of each widget it no
     * longer has or can no longer show, and asks the app layer to forget
     * the second, as after a change of role (docs/design.md, section 2.2);
     * then gives the focus to the tile that took the place of one the user
     * closed. It judges by the description of the copy alone, and does
     * nothing while the one fetched is behind or ahead of it: a list can
     * come before the description of the change of role that lets it be
     * drawn, which is asked for and calls it again. Returns the tiles it
     * made, which have the description already.
     */
    const syncTiles = (): ReadonlySet<WidgetId> => {
      const made = new Set<WidgetId>();
      const list = connection.widgets();
      const now = table.current();
      if (list === null || now === null) {
        return made;
      }
      widgets = list.widgets.filter((widget) => widgetFits(widget.spec, now));
      for (const widget of list.widgets) {
        if (!widgetFits(widget.spec, now) && !unfit.has(widget.id)) {
          unfit.add(widget.id);
          closeWidget(connection, widget.id, defectBar.show);
        }
      }
      const wanted = new Set(widgets.map((widget) => widget.id));
      for (const [id, tile] of tiles) {
        if (!wanted.has(id)) {
          tile.destroy();
          tiles.delete(id);
          copies.delete(id);
        }
      }
      drawFrame();
      for (const widget of widgets) {
        if (tiles.has(widget.id)) {
          continue;
        }
        const make = kind.tiles[widget.spec.kind];
        if (make === undefined) {
          throw defect(`a widget of the kind ${widget.spec.kind} in the ${kind.title} window`);
        }
        const element = root.querySelector(`[data-tile="${String(widget.id)}"]`);
        if (!(element instanceof HTMLElement)) {
          throw defect(`no tile drawn for widget ${String(widget.id)}`);
        }
        const { id } = widget;
        const copy = nextCopy(widget.spec, [...copies.values()]);
        copies.set(id, { spec: widget.spec, copy });
        const tile = make(element, widget, copy, context, () => {
          close(id);
        });
        tiles.set(id, tile);
        made.add(id);
        tile.described(now);
      }
      if (closing !== null && !wanted.has(closing.id)) {
        const next = widgets[Math.min(closing.index, widgets.length - 1)];
        closing = null;
        if (next !== undefined) {
          tiles.get(next.id)?.focus();
        }
      }
      return made;
    };

    const describe = async (): Promise<void> => {
      await table.fetch();
      // A description of another shape than the copy's is followed by
      // another, asked for as the copy's table changes.
      const described = table.current();
      if (described === null) {
        return;
      }
      // The tiles the table can no longer show go first: a map of countries
      // given a column that is no longer of countries cannot draw it.
      const made = syncTiles();
      for (const [id, tile] of tiles) {
        if (!made.has(id)) {
          tile.described(described);
        }
      }
      hoverLabel.refresh();
      groups.redraw();
    };

    state.subscribe("table", () => {
      describe().catch(defectBar.show);
    });
    // The label's values come with the description, fetched again above.
    for (const aspect of ["codes", "classification"] as const) {
      state.subscribe(aspect, hoverLabel.refresh);
    }
    connection.onWidgets(() => {
      syncTiles();
    });
    window.addEventListener("keydown", (event) => {
      // Escape hides the label beside the pointer, which may cover the
      // groups panel, until the pointer moves (decided by the owner on
      // 4 October 2026).
      if (event.key === "Escape") {
        for (const tile of tiles.values()) {
          tile.forgetPointer();
        }
      }
      const waiting = [...tiles.values()].find((tile) => tile.lassoWaiting());
      if (waiting === undefined) {
        return;
      }
      // An Enter a plot took, as the histogram's, selects there alone.
      if (event.key === "Enter" && !event.defaultPrevented) {
        event.preventDefault();
        waiting.applyLasso();
      } else if (event.key === "Escape") {
        event.preventDefault();
        waiting.dropLasso();
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
      "assigning",
    );
    // After the lasso's keys and the panel's, which take Escape first.
    installSelectionKeys(window, connection, defectBar.show);
    if (import.meta.env.DEV) {
      // For the e2e tests alone, which find a bar, a point or a country
      // where it is drawn; a build for users has no such name.
      Reflect.set(globalThis, "__vavilovPlotOf", (id: number) => {
        for (const [each, tile] of tiles) {
          if (each === id) {
            return tile.plot;
          }
        }
        return undefined;
      });
      // The revision of the window's copy, by which a test waits for the
      // changes its clicks made to come back before it clicks again.
      Reflect.set(globalThis, "__vavilovRevision", () => Number(connection.state.revision()));
    }
    await connection.windowWidgets();
    await describe();
  } catch (error: unknown) {
    defectBar.show(error);
  }
}
