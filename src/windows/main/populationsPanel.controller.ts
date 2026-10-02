import { nothing, render } from "lit-html";

import type { Answer, Connection } from "../../backend/connection.ts";
import type { TableDescription } from "../../state/description.ts";
import { populationsModel } from "../../state/populations.ts";
import type { PopulationRow } from "../../state/populations.ts";
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
  description: () => TableDescription | null,
  report: (error: unknown) => void,
): PopulationsPanel {
  const { state } = connection;
  let mode: PointerMode = "move";

  const answered =
    (what: string) =>
    (answer: Answer): void => {
      if (!answer.ok) {
        console.warn(`Vavilov Explorer: ${what} was refused`, answer.error);
      }
    };

  const press = (row: PopulationRow): void => {
    const active = state.active();
    if (active === null) {
      return;
    }
    connection
      .selectPopulation(active.column, row.isSelected ? null : row.selected)
      .then(answered("selecting a population"), report);
  };

  const draw = (): void => {
    const table = description();
    if (table === null) {
      render(nothing, element);
      return;
    }
    const model = populationsModel(table, state.active(), state.codes);
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
            .then(answered("choosing the classification"), report);
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
