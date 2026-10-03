import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";

import type { AxisColumn } from "../../state/scatterAxes.ts";
import type { Axes } from "../../state/widget.ts";
import { classOf } from "../shared/classOf.ts";
import styles from "../shared/dialog.module.css";

/** What the dialog of a 3D scatter shows: the columns it offers and the axes chosen. */
export interface Scatter3dChoice {
  /** The columns an axis can take, in the order of the table. */
  readonly columns: readonly AxisColumn[];
  /** The columns chosen for the x, y and z axes. */
  readonly axes: Axes;
}

/** What the dialog shows, and what the user's actions do. */
export interface Scatter3dDialogProps {
  /** The choice shown, or `null` while the dialog is closed. */
  readonly choice: Scatter3dChoice | null;
  /** The user chose another column for an axis. */
  readonly onChange: (axes: Axes) => void;
  /** The user answered: `true` to open the 3D scatter, `false` not to. */
  readonly onAnswer: (confirmed: boolean) => void;
}

/** The three axes, each with the id of its dropdown and its label. */
const AXES = [
  { id: "scatter3d-x", label: "X axis" },
  { id: "scatter3d-y", label: "Y axis" },
  { id: "scatter3d-z", label: "Z axis" },
] as const;

/** `axes` with the axis at `index` given `column`. */
function withAxis(axes: Axes, index: number, column: AxisColumn): Axes {
  const [x, y, z] = axes;
  return [index === 0 ? column.id : x, index === 1 ? column.id : y, index === 2 ? column.id : z];
}

function axisSelect(
  index: number,
  choice: Scatter3dChoice,
  onChange: (axes: Axes) => void,
): TemplateResult {
  const axis = AXES[index];
  const chosen = choice.axes[index];
  if (axis === undefined || chosen === undefined) {
    return html``;
  }
  return html`<label for=${axis.id} class=${classOf(styles, "label")}>${axis.label}</label>
    <select
      id=${axis.id}
      class=${classOf(styles, "select")}
      @change=${(event: Event) => {
        const selected =
          event.target instanceof HTMLSelectElement ? event.target.selectedIndex : -1;
        const column = choice.columns[selected];
        if (column !== undefined) {
          onChange(withAxis(choice.axes, index, column));
        }
      }}
    >
      ${choice.columns.map(
        (column) => html`<option .selected=${live(column.id === chosen)}>${column.name}</option>`,
      )}
    </select>`;
}

/**
 * The dialog of Plot > 3D scatter…: a dropdown of the columns of numbers for
 * each axis, then Cancel and Open. The controller opens it as a modal
 * dialog; Enter opens, and Escape cancels.
 */
export function scatter3dDialogView(props: Scatter3dDialogProps): TemplateResult {
  const { choice } = props;
  return html`<dialog
    class=${classOf(styles, "dialog")}
    aria-labelledby="scatter3d-heading"
    @cancel=${(event: Event) => {
      event.preventDefault();
      props.onAnswer(false);
    }}
    @keydown=${(event: KeyboardEvent) => {
      // Enter opens, as Open does, but on a button, whose own it is.
      if (
        event.key === "Enter" &&
        !event.isComposing &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        props.onAnswer(true);
      }
    }}
  >
    ${
      choice === null
        ? nothing
        : html`<h2 id="scatter3d-heading" class=${classOf(styles, "heading")}>3D scatter</h2>
            <div class=${classOf(styles, "fields")}>
              ${AXES.map((_, index) => axisSelect(index, choice, props.onChange))}
            </div>
            <div class=${classOf(styles, "answers")}>
              <button
                type="button"
                class=${classOf(styles, "answer")}
                @click=${() => {
                  props.onAnswer(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                class=${classOf(styles, "answer")}
                @click=${() => {
                  props.onAnswer(true);
                }}
              >
                Open
              </button>
            </div>`
    }
  </dialog>`;
}
