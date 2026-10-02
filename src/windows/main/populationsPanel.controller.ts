import { nothing, render } from "lit-html";

import type { Connection } from "../../backend/connection.ts";
import type { DescriptionNow } from "../../state/description.ts";
import { populationsModel } from "../../state/populations.ts";
import type { PopulationRow } from "../../state/populations.ts";
import { answered } from "../shared/answered.ts";
import { populationsPanelView } from "./populationsPanel.view.ts";
import type { PointerMode } from "./populationsPanel.view.ts";

/** The populations panel in its element. */
export interface PopulationsPanel {
  /** Draws the panel again, when the description of the table has changed. */
  readonly redraw: () => void;
  /** The pointer's mode, which the plots will read. */
  readonly mode: () => PointerMode;
  /** Unsubscribes and empties the element. */
  readonly destroy: () => void;
}

/**
 * The populations panel: it shows the classifications and the populations of
 * the active one, and turns the user's choices into commands. The pointer's
 * mode is the main window's own until the owner decides whether it is shared
 * (docs/design.md, section 2.1).
 */
export function createPopulationsPanel(
  element: HTMLElement,
  connection: Connection,
  description: () => DescriptionNow,
  mark: string,
  report: (error: unknown) => void,
): PopulationsPanel {
  const { state } = connection;
  let mode: PointerMode = "move";

  const press = (row: PopulationRow): void => {
    const active = state.active();
    if (active === null) {
      return;
    }
    connection
      .selectPopulation(active.column, row.isSelected ? null : row.selected)
      .then(answered("selecting a population", draw), report);
  };

  const draw = (): void => {
    const now = description();
    if (now.kind === "none") {
      render(nothing, element);
      return;
    }
    if (now.kind === "behind") {
      // The description of the copy's shape is on its way, and draws again.
      return;
    }
    const table = now.description;
    const model = populationsModel(table, state.active(), state.codes, mark);
    const selected = model.rows.find((row) => row.isSelected)?.selected ?? null;
    if (selected === null || (selected.kind === "unassigned" && mode === "remove")) {
      mode = "move";
    }
    render(
      populationsPanelView({
        model,
        mode,
        onChooseClassification: (column) => {
          connection
            .setActiveClassification(column)
            .then(answered("choosing the classification", draw), report);
        },
        onPress: press,
        onMode: (chosen) => {
          mode = chosen;
          draw();
        },
      }),
      element,
    );
  };

  const unsubscribes = (["classification", "codes", "table"] as const).map((aspect) =>
    state.subscribe(aspect, draw),
  );
  draw();
  return {
    redraw: draw,
    mode: () => mode,
    destroy: () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      render(nothing, element);
    },
  };
}
