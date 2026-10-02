import { render } from "lit-html";

import { connect } from "../../backend/connection.ts";
import { tauriTransport } from "../../backend/transport.ts";
import { defect } from "../../state/defect.ts";
import type { TableDescription } from "../../state/description.ts";
import { createDefectBar } from "../shared/defectBar.controller.ts";
import { mainWindowView } from "./mainWindow.view.ts";
import { createPopulationsPanel } from "./populationsPanel.controller.ts";
import { createTable } from "./table.controller.ts";

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
  try {
    const connection = await connect(tauriTransport(), defectBar.show);
    const { state } = connection;
    let description: TableDescription | null = null;
    const panel = createPopulationsPanel(
      slot(root, "panel"),
      connection,
      () => description,
      defectBar.show,
    );
    const table = createTable(slot(root, "table"), connection, () => description, defectBar.show);

    /** Asks for the description of the table the copy holds, once per load. */
    const describe = async (): Promise<void> => {
      const project = state.project();
      render(mainWindowView({ open: project.kind === "open" }), root);
      if (project.kind === "noProject") {
        description = null;
        panel.redraw();
        table.redraw();
        return;
      }
      if (description?.loadedAt === project.loadedAt) {
        return;
      }
      const answer = await connection.describeTable();
      const now = state.project();
      if (now.kind === "noProject" || now.loadedAt !== project.loadedAt) {
        // Another table was loaded meanwhile; its own change asks again.
        return;
      }
      if (!answer.ok) {
        throw defect(
          `the table loaded at ${String(project.loadedAt)} has no description: ${answer.error.kind}`,
        );
      }
      if (answer.value.loadedAt !== project.loadedAt) {
        throw defect(
          `a description of the load at ${String(answer.value.loadedAt)} for the one at ${String(project.loadedAt)}`,
        );
      }
      description = answer.value;
      panel.redraw();
      table.redraw();
    };

    state.subscribe("table", () => {
      describe().catch(defectBar.show);
    });
    await describe();
  } catch (error: unknown) {
    defectBar.show(error);
  }
}
