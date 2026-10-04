import type { Connection } from "../../backend/connection.ts";
import type { Refusal } from "../../state/commandError.ts";
import { defect } from "../../state/defect.ts";
import { fileRefusalMessage, isFileRefusal, undecodedMessage } from "../../state/fileMessages.ts";
import { axisColumns, columnsOfRole, startingAxes } from "../../state/plotColumns.ts";
import { csvDefaults } from "../../state/transfer.ts";
import {
  isWidgetRefused,
  noColumnMessage,
  noNumbersMessage,
  noWebGlMessage,
  widgetRefusalMessage,
} from "../../state/widgetMessages.ts";
import type { TableDescription } from "../../state/description.ts";
import type { WidgetSpec } from "../../state/widget.ts";
import type { ExportFormat, MenuAction } from "../../state/transfer.ts";
import { countText } from "../shared/numbers.ts";
import { answered } from "../shared/answered.ts";
import { countRows } from "../../state/rowSet.ts";
import { undoOrRedoField } from "../shared/fieldUndo.ts";
import { canDrawWebGl } from "../shared/webgl.ts";
import type { CsvDialog } from "./csvDialog.controller.ts";
import type { InfoBar } from "../shared/infoBar.controller.ts";
import type { ColumnsDialog } from "./columnsDialog.controller.ts";

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
 * ended, its dialog answered. Plot > 3D scatter…, Map… and Map of
 * countries… ask for the plot's columns and open its window, and tell the
 * bar why they could not, as an error. A refusal that is not about a file
 * or a plot is a defect, since the backend gives none here.
 */
export function createMenuActions(
  connection: Connection,
  infoBar: InfoBar,
  csvDialog: CsvDialog,
  columnsDialog: ColumnsDialog,
  report: (error: unknown) => void,
): MenuActions {
  /** Imports a table, the user's or the example installed with the app, and says what the import found. */
  const importTable = async (from: "file" | "example"): Promise<void> => {
    const answer = await (from === "file" ? connection.importTable() : connection.openExample());
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

  /** The table the backend has now, which an item of the Plot menu offers the columns of. */
  const describe = async (item: string): Promise<TableDescription> => {
    const described = await connection.describeTable();
    if (!described.ok) {
      throw defect(`Plot > ${item} with no table: ${described.error.kind}`);
    }
    return described.value;
  };

  /**
   * Opens the widget `spec`; the backend checks its columns again against
   * its table, and refuses one that changed meanwhile, which the bar says.
   */
  const openWidget = async (spec: WidgetSpec, description: TableDescription): Promise<void> => {
    const answer = await connection.openWidget(spec);
    if (answer.ok) {
      return;
    }
    const { error } = answer;
    if (!isWidgetRefused(error)) {
      throw defect(`a widget of the kind ${spec.kind} refused as ${error.kind}`);
    }
    // The bar says what happened; the system's reason for a window that
    // failed goes to the log.
    console.warn(`Vavilov Explorer: a widget of the kind ${spec.kind} was refused`, error);
    infoBar.tell(
      widgetRefusalMessage(
        spec.kind,
        error,
        (id) => description.columns.find((column) => column.id === id)?.name ?? null,
      ),
    );
  };

  /** Asks for the three axes, from the columns of numbers, and opens the 3D scatter. */
  const openScatter3d = async (): Promise<void> => {
    if (!canDrawWebGl()) {
      infoBar.tell(noWebGlMessage());
      return;
    }
    const description = await describe("3D scatter…");
    const columns = axisColumns(description);
    const axes = startingAxes(description);
    if (axes === null) {
      infoBar.tell(noNumbersMessage("scatter3d"));
      return;
    }
    const chosen = await columnsDialog.ask("3D scatter", [
      { label: "X axis", columns, chosen: axes[0] },
      { label: "Y axis", columns, chosen: axes[1] },
      { label: "Z axis", columns, chosen: axes[2] },
    ]);
    if (chosen === null) {
      return;
    }
    await openWidget({ kind: "scatter3d", axes: chosen }, description);
  };

  /**
   * Asks for a latitude and a longitude column, each from those of its
   * role, starting from the first, and opens the map of the individuals.
   */
  const openMap = async (): Promise<void> => {
    if (!canDrawWebGl()) {
      infoBar.tell(noWebGlMessage());
      return;
    }
    const description = await describe("Map…");
    const latitudes = columnsOfRole(description, "latitude");
    const longitudes = columnsOfRole(description, "longitude");
    const [latitude] = latitudes;
    const [longitude] = longitudes;
    if (latitude === undefined) {
      infoBar.tell(noColumnMessage("latitude"));
      return;
    }
    if (longitude === undefined) {
      infoBar.tell(noColumnMessage("longitude"));
      return;
    }
    const chosen = await columnsDialog.ask("Map", [
      { label: "Latitude column", columns: latitudes, chosen: latitude.id },
      { label: "Longitude column", columns: longitudes, chosen: longitude.id },
    ]);
    if (chosen === null) {
      return;
    }
    const [latitudeId, longitudeId] = chosen;
    await openWidget({ kind: "map", latitude: latitudeId, longitude: longitudeId }, description);
  };

  /**
   * Asks for a column of numbers, starting from the first plain number, and
   * opens its histogram, which needs no WebGL.
   */
  const openHistogram = async (): Promise<void> => {
    const description = await describe("Histogram…");
    const columns = axisColumns(description);
    const first = startingAxes(description)?.[0];
    if (first === undefined) {
      infoBar.tell(noNumbersMessage("histogram"));
      return;
    }
    const chosen = await columnsDialog.ask("Histogram", [
      { label: "Column", columns, chosen: first },
    ]);
    if (chosen === null) {
      return;
    }
    const [column] = chosen;
    await openWidget({ kind: "histogram", column }, description);
  };

  /** Asks for a column of countries, starting from the first, and opens the map of countries. */
  const openCountryMap = async (): Promise<void> => {
    if (!canDrawWebGl()) {
      infoBar.tell(noWebGlMessage());
      return;
    }
    const description = await describe("Map of countries…");
    const countries = columnsOfRole(description, "country");
    const [first] = countries;
    if (first === undefined) {
      infoBar.tell(noColumnMessage("country"));
      return;
    }
    const chosen = await columnsDialog.ask("Map of countries", [
      { label: "Country column", columns: countries, chosen: first.id },
    ]);
    if (chosen === null) {
      return;
    }
    const [country] = chosen;
    await openWidget({ kind: "countryMap", country }, description);
  };

  /** Clears the selection, Edit > Select None; with none selected, nothing is sent. */
  const selectNone = (): Promise<void> => {
    const now = connection.state.selection();
    if (now === null || countRows(now) === 0) {
      return Promise.resolve();
    }
    return connection
      .setSelection(new Uint8Array(now.length))
      .then(answered("selecting none", ignore));
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
        return importTable("file");
      case "openExample":
        return importTable("example");
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
      case "scatter3d":
        return openScatter3d();
      case "map":
        return openMap();
      case "countryMap":
        return openCountryMap();
      case "histogram":
        return openHistogram();
      case "selectNone":
        return selectNone();
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
