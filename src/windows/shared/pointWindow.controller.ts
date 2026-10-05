import { connect } from "../../backend/connection.ts";
import { tauriTransport } from "../../backend/transport.ts";
import { widgetFits } from "../../state/plotColumns.ts";
import { onlyWidget } from "../../state/widget.ts";
import type { WidgetSpec } from "../../state/widget.ts";
import { closeWidget } from "./closeWidget.ts";
import { createDescribedTable } from "./describedTable.ts";
import { createGroupsPanel } from "./groupsPanel.controller.ts";
import { createHoverLabel } from "./hoverLabel.controller.ts";
import { createInfoBar } from "./infoBar.controller.ts";
import { startPlotFrame } from "./plotWindow.controller.ts";
import { createHoverSender, createPointView, titlesOf } from "./pointView.controller.ts";
import type { PointViewKind } from "./pointView.controller.ts";
import { installSelectionKeys } from "./selectionKeys.ts";
import { slot } from "./slot.ts";

/**
 * Starts the window of a point view in `root`, a 3D scatter, of the kind
 * `kindOf` gives for the window's one widget, titled `untitled` until it
 * knows its columns: the frame, the bar of a defect, the connection to the
 * backend, the point view (pointView.controller.ts), its groups panel and
 * its information bar, which counts the individuals it draws; Enter applies
 * the lasso waiting and Escape drops it (docs/design.md, section 2.2). The
 * window asks the app layer to forget its widget, and so to close it, when
 * a change of role leaves it a column it cannot show.
 */
export async function startPointWindow(
  root: HTMLElement,
  untitled: string,
  kindOf: (spec: WidgetSpec) => PointViewKind,
): Promise<void> {
  const defectBar = startPlotFrame(root, untitled, { legend: false, webGl: true });
  if (defectBar === null) {
    return;
  }
  try {
    const connection = await connect(tauriTransport(), defectBar.show);
    const { state } = connection;
    const widget = onlyWidget((await connection.windowWidgets()).widgets);
    const kind = kindOf(widget.spec);
    const decimalMark = await connection.regionDecimalMark();
    const table = createDescribedTable(connection);
    const hoverLabel = createHoverLabel(
      slot(root, "label"),
      connection,
      table.current,
      decimalMark,
      defectBar.show,
    );
    // The view first: the bar asks it for its count as soon as it is made,
    // and the view tells the bar only once its columns have arrived.
    const view = createPointView(slot(root, "plot"), kind, {
      connection,
      table,
      decimalMark,
      hoverLabel,
      hover: createHoverSender(connection, defectBar.show),
      report: defectBar.show,
      // The bar is made below, before any answer comes back.
      tell: (message) => {
        infoBar.tell(message);
      },
      tokens: root,
      // The window has one view, whose lasso is the only one.
      onLassoWaiting: () => undefined,
      onDrawn: () => {
        infoBar.recount();
      },
    });
    const infoBar = createInfoBar(
      slot(root, "info"),
      state,
      // How many individuals the plot draws, counted as it draws.
      { aspects: [], text: () => view.count() },
      () => {
        view.focus();
      },
    );

    const describe = async (): Promise<void> => {
      await table.fetch();
      // A description of another shape than the copy's is followed by
      // another, asked for as the copy's table changes.
      const described = table.current();
      if (described === null) {
        return;
      }
      // A change of role that leaves the plot a column it cannot show
      // closes it, and with it the window.
      if (!widgetFits(widget.spec, described)) {
        closeWidget(connection, widget.id, defectBar.show);
        return;
      }
      document.title = kind.title(titlesOf(described, kind.columns));
      view.described();
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
    window.addEventListener("keydown", (event) => {
      if (!view.lassoWaiting()) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        view.applyLasso();
      } else if (event.key === "Escape") {
        event.preventDefault();
        view.dropLasso();
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
    // After the lasso's keys and the panel's, which take Escape first.
    installSelectionKeys(window, connection, defectBar.show);
    if (import.meta.env.DEV) {
      // For the e2e tests alone, which find a point where it is drawn; a
      // build for users has no such name.
      Reflect.set(globalThis, "__vavilovPlot", view.plot);
    }
    await describe();
  } catch (error: unknown) {
    defectBar.show(error);
  }
}
