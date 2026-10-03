import { render } from "lit-html";

import { connect } from "../../backend/connection.ts";
import { tauriTransport } from "../../backend/transport.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow, TableDescription } from "../../state/description.ts";
import { createDialog } from "../shared/dialog.controller.ts";
import { createDefectBar } from "../shared/defectBar.controller.ts";
import { installFieldUndo } from "../shared/fieldUndo.ts";
import { createCsvDialog } from "./csvDialog.controller.ts";
import { createFindBar } from "./findBar.controller.ts";
import { createInfoBar } from "./infoBar.controller.ts";
import { mainWindowView } from "./mainWindow.view.ts";
import { createPopulationsPanel } from "./populationsPanel.controller.ts";
import { createTable } from "./table.controller.ts";
import { createMenuActions } from "./menuActions.controller.ts";

function slot(root: HTMLElement, name: string): HTMLElement {
  const element = root.querySelector(`[data-slot="${name}"]`);
  if (!(element instanceof HTMLElement)) {
    throw defect(`the main window without its slot ${name}`);
  }
  return element;
}

/**
 * Starts the main window in `root`: the frame, the bar of a defect, the
 * connection to the backend, the populations panel and the table, with the description
 * of the table asked again whenever another table is loaded.
 */
export async function startMainWindow(root: HTMLElement): Promise<void> {
  render(mainWindowView({ open: false }), root);
  const defectBar = createDefectBar(slot(root, "defect"), window);
  installFieldUndo(window);
  try {
    const connection = await connect(tauriTransport(), defectBar.show);
    const { state } = connection;
    // The decimal mark of the system's region, which Excel follows, read
    // once: a change of the region shows after the window is reloaded.
    const decimalMark = await connection.regionDecimalMark();
    let description: TableDescription | null = null;
    /**
     * The description, when it is that of the copy's load and shape: a
     * component draws only from a description that agrees with the codes
     * and revisions of the copy.
     */
    const describedNow = (): DescriptionNow => {
      const project = state.project();
      if (project.kind === "noProject") {
        return { kind: "none" };
      }
      if (description?.loadedAt !== project.loadedAt || description.shapeAt !== state.shapeAt()) {
        return { kind: "behind" };
      }
      return { kind: "current", description };
    };
    const panel = createPopulationsPanel(
      slot(root, "panel"),
      connection,
      describedNow,
      decimalMark,
      defectBar.show,
    );
    const findBar = createFindBar(
      slot(root, "find"),
      connection,
      describedNow,
      decimalMark,
      defectBar.show,
    );
    const dialog = createDialog(slot(root, "dialog"));
    const infoBar = createInfoBar(slot(root, "info"), state, () => {
      table.focus();
    });
    const table = createTable(
      slot(root, "table"),
      connection,
      describedNow,
      decimalMark,
      dialog.ask,
      infoBar.tell,
      defectBar.show,
    );
    createMenuActions(connection, infoBar, createCsvDialog(slot(root, "export")), defectBar.show);

    /**
     * Asks for the description of the table the copy holds, once per load
     * and once per change of its shape, such as a column's role.
     */
    const describe = async (): Promise<void> => {
      const project = state.project();
      render(mainWindowView({ open: project.kind === "open" }), root);
      if (project.kind === "noProject") {
        description = null;
        panel.redraw();
        table.redraw();
        findBar.redraw();
        return;
      }
      const shapeAt = state.shapeAt();
      if (shapeAt === null) {
        throw defect(`the table loaded at ${String(project.loadedAt)} has no shape`);
      }
      if (description?.loadedAt === project.loadedAt && description.shapeAt === shapeAt) {
        return;
      }
      const answer = await connection.describeTable();
      const now = state.project();
      if (
        now.kind === "noProject" ||
        now.loadedAt !== project.loadedAt ||
        state.shapeAt() !== shapeAt
      ) {
        // Another table or shape came meanwhile; its own change asks again.
        return;
      }
      if (!answer.ok) {
        throw defect(
          `the table loaded at ${String(project.loadedAt)} has no description: ${answer.error.kind}`,
        );
      }
      const { value } = answer;
      if (value.loadedAt > project.loadedAt || value.shapeAt > shapeAt) {
        // The backend is ahead of the copy: the change on its way asks again.
        return;
      }
      if (value.loadedAt !== project.loadedAt || value.shapeAt !== shapeAt) {
        throw defect(
          `a description of the load at ${String(value.loadedAt)} and the shape at ${String(value.shapeAt)} for the copy's ${String(project.loadedAt)} and ${String(shapeAt)}`,
        );
      }
      description = value;
      panel.redraw();
      table.redraw();
      findBar.redraw();
    };

    state.subscribe("table", () => {
      describe().catch(defectBar.show);
    });
    await describe();
  } catch (error: unknown) {
    defectBar.show(error);
  }
}
