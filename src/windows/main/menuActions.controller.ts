import type { Connection } from "../../backend/connection.ts";
import type { Refusal } from "../../state/commandError.ts";
import { defect } from "../../state/defect.ts";
import { fileRefusalText, isFileRefusal, undecodedText } from "../../state/fileMessages.ts";
import { csvDefaults } from "../../state/transfer.ts";
import type { ExportFormat, MenuAction } from "../../state/transfer.ts";
import type { Dialog } from "../shared/dialog.controller.ts";
import type { Notice } from "../shared/notice.controller.ts";
import { countText } from "../shared/numbers.ts";
import { answered } from "../shared/answered.ts";
import type { CsvDialog } from "./csvDialog.controller.ts";

/** Nothing to draw again after an undo or a redo the backend did not apply. */
const ignore = (): void => undefined;

/** The items of the menu the main window carries out. */
export interface MenuActions {
  /** Stops listening to the menu. */
  readonly destroy: () => void;
}

/**
 * Carries out the items of the menu that the backend hands to the main
 * window: Import table… asks the backend to import, and shows a refusal in
 * the dialog, and a character it could not decode in the notice; Export as
 * CSV… asks for the CSV's choices first, and both exports show a refusal in
 * the dialog (docs/design.md, sections 2.1 and 7); Undo and Redo ask the
 * backend to undo or redo the last edit of the window's copy. The items are carried out
 * one at a time, in the order they came, each once the one before has
 * ended, its dialogs answered. A refusal that is not about a file is a
 * defect, since the backend gives none here.
 */
export function createMenuActions(
  connection: Connection,
  dialog: Dialog,
  notice: Notice,
  csvDialog: CsvDialog,
  report: (error: unknown) => void,
): MenuActions {
  const importTable = async (): Promise<void> => {
    const answer = await connection.importTable();
    if (!answer.ok) {
      await refused(answer.error);
      return;
    }
    const { value } = answer;
    if (value === "stale" || value.kind !== "imported") {
      return;
    }
    // The notice of an earlier file is not about the table there is now.
    notice.clear();
    if (value.undecodedLine !== null) {
      notice.show(undecodedText(value.fileName, value.undecodedLine, countText));
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
      await refused(answer.error);
    }
  };

  const refused = async (error: Refusal): Promise<void> => {
    if (!isFileRefusal(error)) {
      throw defect(`an import or an export refused as ${error.kind}`);
    }
    await dialog.tell(fileRefusalText(error, countText));
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
        return connection.undo().then(answered("undoing", ignore));
      case "redo":
        return connection.redo().then(answered("redoing", ignore));
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
