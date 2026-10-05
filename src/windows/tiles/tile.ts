// What a tile of a window of tiles is to its window, and what the window
// shares with its tiles (docs/design.md, section 2.2).

import type { Connection } from "../../backend/connection.ts";
import type { TableDescription } from "../../state/description.ts";
import type { WidgetId } from "../../state/ids.ts";
import type { Widget } from "../../state/widget.ts";
import type { BarMessage } from "../../state/barMessages.ts";
import type { DescribedTable } from "../shared/describedTable.ts";
import type { HoverLabelComponent } from "../shared/hoverLabel.controller.ts";
import type { HoverSender } from "../shared/pointView.controller.ts";
import type { TextLabel } from "../shared/textLabel.controller.ts";

/** What every tile of a window shares: the window's connection and its parts. */
export interface TileContext {
  /** The window's connection to the backend, and its copy of the state. */
  readonly connection: Connection;
  /** The description of the table, which the window asks for again as it changes. */
  readonly table: DescribedTable;
  /** The decimal mark of the system's region. */
  readonly decimalMark: string;
  /** The window's label of text beside the pointer, of a bar or a country. */
  readonly label: TextLabel;
  /** The window's label of the individual under the pointer, on a point. */
  readonly hoverLabel: HoverLabelComponent;
  /** The window's sender of the hover. */
  readonly hover: HoverSender;
  /** Shows a defect in the window's bar. */
  readonly report: (error: unknown) => void;
  /** Shows a message in the window's information bar. */
  readonly tell: (message: BarMessage) => void;
  /** The element whose tokens give the colours of the points with no group. */
  readonly tokens: HTMLElement;
  /** The tile `id` drew a lasso that waits for Enter: the window drops any other tile's. */
  readonly onLassoWaiting: (id: WidgetId) => void;
}

/** A tile of a window of tiles, drawn in its element. */
export interface PlotTile {
  /** Takes the description of the table the window fetched, and draws again. */
  readonly described: (description: TableDescription) => void;
  /** Gives the keyboard's focus to the plot. */
  readonly focus: () => void;
  /** Hides the label of what is under the pointer until it moves, Escape. */
  readonly forgetPointer: () => void;
  /** Whether a lasso drawn in the tile waits for Enter. */
  readonly lassoWaiting: () => boolean;
  /** Applies the lasso waiting, Enter. */
  readonly applyLasso: () => void;
  /** Drops the lasso waiting, Escape, or because another tile drew one. */
  readonly dropLasso: () => void;
  /** The plot's handle, for the e2e tests alone. */
  readonly plot: unknown;
  /** Unsubscribes, destroys the plot, and empties the element. */
  readonly destroy: () => void;
}

/**
 * Makes the tile of `widget` in `element`, the copy `copy` of its plot in
 * the window, from 1, which it names after the first (tileCopy.ts), and
 * which asks `onClose` to close it when the user presses its button.
 */
export type TileMaker = (
  element: HTMLElement,
  widget: Widget,
  copy: number,
  context: TileContext,
  onClose: () => void,
) => PlotTile;
