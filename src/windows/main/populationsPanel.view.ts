import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { styleMap } from "lit-html/directives/style-map.js";

import type { ColumnId } from "../../state/ids.ts";
import type { Selected } from "../../state/message.ts";
import type { PopulationRow, PopulationsModel } from "../../state/populations.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "./populationsPanel.module.css";

/** What the pointer does in the plots while something is selected for editing. */
export type PointerMode = "move" | "add" | "remove";

/** What the populations panel shows, and what the user can do there. */
export interface PopulationsPanelProps {
  /** The classifications, the active one, and its rows. */
  readonly model: PopulationsModel;
  /** The pointer's mode. */
  readonly mode: PointerMode;
  /** The user chose an active classification, or none. */
  readonly onChooseClassification: (column: ColumnId | null) => void;
  /** The user pressed a row. */
  readonly onPress: (row: PopulationRow) => void;
  /** The user chose a mode. */
  readonly onMode: (mode: PointerMode) => void;
}

const MODES: readonly {
  readonly mode: PointerMode;
  readonly symbol: string;
  readonly label: string;
}[] = [
  { mode: "move", symbol: "↻", label: "Move" },
  { mode: "add", symbol: "+", label: "Add" },
  { mode: "remove", symbol: "−", label: "Remove" },
];

const COUNT = new Intl.NumberFormat();
const NO_REMOVE_HINT = "populations-no-remove";

function keyOf(selected: Selected): string {
  return selected.kind === "unassigned" ? "unassigned" : String(selected.code);
}

/** The populations panel of the main window (docs/design.md, section 2.1). */
export function populationsPanelView(props: PopulationsPanelProps): TemplateResult {
  const { model } = props;
  const selected = model.rows.find((row) => row.isSelected)?.selected ?? null;
  const unassignedSelected = selected?.kind === "unassigned";
  return html`<section class=${classOf(styles, "panel")} aria-labelledby="populations-heading">
    <h2 id="populations-heading" class=${classOf(styles, "heading")}>Populations</h2>
    <label class=${classOf(styles, "field")}>
      <span>Classification column</span>
      <select
        class=${classOf(styles, "select")}
        @change=${(event: Event) => {
          const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
          props.onChooseClassification(
            model.classifications.find((choice) => String(choice.column) === value)?.column ?? null,
          );
        }}
      >
        <option value="" ?selected=${model.active === null}>None</option>
        ${repeat(
          model.classifications,
          (choice) => choice.column,
          (choice) =>
            html`<option value=${String(choice.column)} ?selected=${choice.column === model.active}>
              ${choice.name}
            </option>`,
        )}
      </select>
    </label>
    ${
      model.rows.length === 0
        ? nothing
        : html`<ul class=${classOf(styles, "list")}>
            ${repeat(
              model.rows,
              (row) => keyOf(row.selected),
              (row) =>
                html`<li>
                  <button
                    type="button"
                    class=${classOf(styles, "row")}
                    aria-pressed=${row.isSelected ? "true" : "false"}
                    @click=${() => {
                      props.onPress(row);
                    }}
                  >
                    <span
                      class=${classOf(styles, row.colour === null ? "swatchNone" : "swatch")}
                      style=${styleMap(row.colour === null ? {} : { backgroundColor: row.colour })}
                      aria-hidden="true"
                    ></span>
                    <span class=${classOf(styles, "name")}>${row.name ?? "Unassigned"}</span>
                    <span class=${classOf(styles, "count")}>${COUNT.format(row.count)}</span>
                  </button>
                </li>`,
            )}
          </ul>`
    }
    ${
      selected === null
        ? nothing
        : html`<fieldset class=${classOf(styles, "modes")}>
            <legend class=${classOf(styles, "legend")}>Pointer</legend>
            ${MODES.map(
              (choice) =>
                html`<label class=${classOf(styles, "mode")}>
                  <input
                    type="radio"
                    name="pointer-mode"
                    .checked=${props.mode === choice.mode}
                    ?disabled=${choice.mode === "remove" && unassignedSelected}
                    aria-describedby=${choice.mode === "remove" && unassignedSelected ? NO_REMOVE_HINT : nothing}
                    @change=${() => {
                      props.onMode(choice.mode);
                    }}
                  />
                  <span aria-hidden="true">${choice.symbol}</span> ${choice.label}
                </label>`,
            )}
            ${
              unassignedSelected
                ? html`<p id=${NO_REMOVE_HINT} class=${classOf(styles, "hint")}>
                    Unassigned individuals are in no population to remove them from.
                  </p>`
                : nothing
            }
          </fieldset>`
    }
  </section>`;
}
