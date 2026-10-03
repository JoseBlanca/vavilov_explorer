import type { Connection } from "../../backend/connection.ts";
import type { Refusal } from "../../state/commandError.ts";
import { defect } from "../../state/defect.ts";
import { fileRefusalMessage, isFileRefusal, undecodedMessage } from "../../state/fileMessages.ts";
import { csvDefaults } from "../../state/transfer.ts";
import type { ExportFormat, MenuAction } from "../../state/transfer.ts";
import { countText } from "../shared/numbers.ts";
import { answered } from "../shared/answered.ts";
import { undoOrRedoField } from "../shared/fieldUndo.ts";
import type { CsvDialog } from "./csvDialog.controller.ts";
import type { InfoBar } from "./infoBar.controller.ts";

/** Nothing to draw again after an undo or a redo the backend did not apply. */
const ignore = (): void => undefined;

/** The items of the menu the main window carries out. */
export interface MenuActions {
  /** Stops listening to the menu. */
  readonly destroy: () => void;
}

/**
 * Carries out the items of the menu that the backend hands to the main
 * window: Import table… asks the backend to import, and tells the
 * information bar of a refusal, as an error, or of a character it could
 * not decode, as a warning, after clearing the bar of the messages about
 * the table and the files before; Export as CSV… asks for the CSV's
 * choices first, and both exports tell the bar of a refusal, as an error
 * (docs/design.md, sections 2.1 and 7); Undo and Redo ask the
 * backend to undo or redo the last edit of the window's copy, or the
 * typing of the text field that has the focus. The items are carried out
 * one at a time, in the order they came, each once the one before has
 * ended, its dialog answered. A refusal that is not about a file is a
 * defect, since the backend gives none here.
 */
export function createMenuActions(
  connection: Connection,
  infoBar: InfoBar,
  csvDialog: CsvDialog,
  report: (error: unknown) => void,
): MenuActions {
  const importTable = async (): Promise<void> => {
    const answer = await connection.importTable();
    if (!answer.ok) {
      refused(answer.error);
      return;
    }
    const { value } = answer;
    if (value === "stale" || value.kind !== "imported") {
      return;
    }
    // The messages before were about the table and the files before.
    infoBar.clear();
    if (value.undecodedLine !== null) {
      infoBar.tell(undecodedMessage(value.fileName, value.undecodedLine, countText));
    }
  };

  const exportTable = async (kind: ExportFormat["kind"]): Promise<void> => {
    let format: ExportFormat = { kind: "xlsx" };
    if (kind === "csv") {
      const choices = await csvDialog.ask(csvDefaults(await connection.regionDecimalMark()));
      if (choices === null) {
        return;
      }
      format = { kind: "csv", choices };
    }
    const answer = await connection.exportTable(format);
    if (!answer.ok) {
      refused(answer.error);
    }
  };

  const refused = (error: Refusal): void => {
    if (!isFileRefusal(error)) {
      throw defect(`an import or an export refused as ${error.kind}`);
    }
    infoBar.tell(fileRefusalMessage(error, countText));
  };

  const run = (action: MenuAction): Promise<void> => {
    switch (action) {
      case "importTable":
        return importTable();
      case "exportCsv":
        return exportTable("csv");
      case "exportXlsx":
        return exportTable("xlsx");
      case "undo":
        return undoOrRedoField("undo")
          ? Promise.resolve()
          : connection.undo().then(answered("undoing", ignore));
      case "redo":
        return undoOrRedoField("redo")
          ? Promise.resolve()
          : connection.redo().then(answered("redoing", ignore));
    }
  };

  /** The end of the last item carried out, after which the next one starts. */
  let queue: Promise<void> = Promise.resolve();
  const carryOut = (action: MenuAction): void => {
    queue = queue.then(() => run(action)).catch(report);
  };

  const stop = connection.onAction(carryOut);
  return { destroy: stop };
}
