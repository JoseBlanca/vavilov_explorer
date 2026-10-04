import type { Connection } from "../../backend/connection.ts";
import { defect } from "../../state/defect.ts";
import type { WidgetId } from "../../state/ids.ts";

/**
 * Asks the app layer to forget the widget `widget` of this window, whose
 * tile the user closed or which the window cannot show (docs/design.md,
 * section 2.2); the app layer closes the window with its last widget. A
 * widget forgotten a moment before, by the window's other request, is gone
 * already, as asked; any other refusal is a defect, given to `report`.
 */
export function closeWidget(
  connection: Connection,
  widget: WidgetId,
  report: (error: unknown) => void,
): void {
  connection
    .closeWidget(widget)
    .then((answer) => {
      if (!answer.ok && answer.error.kind !== "unknownWidget") {
        throw defect(`closing widget ${String(widget)} was refused as ${answer.error.kind}`);
      }
    })
    .catch(report);
}
