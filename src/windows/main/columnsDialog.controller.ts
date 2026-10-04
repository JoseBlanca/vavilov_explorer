import type { ColumnId } from "../../state/ids.ts";
import { createModal } from "../shared/modal.ts";
import { columnsDialogView } from "./columnsDialog.view.ts";
import type { ColumnField, ColumnsChoice } from "./columnsDialog.view.ts";

/** A column for each field of `F`, in the same order. */
export type Chosen<F extends readonly ColumnField[]> = { readonly [K in keyof F]: ColumnId };

/** The dialog of an item of the Plot menu, in its element. */
export interface ColumnsDialog {
  /**
   * Shows the dialog `title` with `fields`, and resolves with the columns
   * the user opens the plot with, one per field in their order, or `null`
   * when they cancel.
   */
  readonly ask: <const F extends readonly ColumnField[]>(
    title: string,
    fields: F,
  ) => Promise<Chosen<F> | null>;
  /** Cancels a dialog that is open and empties the element. */
  readonly destroy: () => void;
}

/**
 * The dialog of Plot > 3D scatter…, Map… and Map of countries…, in
 * `element`: modal, it takes the focus and gives it back to where it was
 * when it closes. It keeps the columns the user is choosing, which are the
 * component's own until they open the plot.
 */
export function createColumnsDialog(element: HTMLElement): ColumnsDialog {
  const modal = createModal<ColumnsChoice, readonly ColumnId[] | null>(
    element,
    "dialog of a plot's columns",
    ({ content, answer, change }) =>
      columnsDialogView({
        choice: content,
        onChange: (index, column) => {
          if (content !== null) {
            change({
              ...content,
              fields: content.fields.map((field, each) =>
                each === index ? { ...field, chosen: column } : field,
              ),
            });
          }
        },
        onAnswer: (confirmed) => {
          answer(
            confirmed && content !== null ? content.fields.map((field) => field.chosen) : null,
          );
        },
      }),
    null,
  );
  return {
    ask: async <const F extends readonly ColumnField[]>(title: string, fields: F) => {
      const chosen = await modal.show({ title, fields });
      // An assertion: the modal answers one column per field of `fields`, in their order, which its type cannot say
      return chosen as Chosen<F> | null;
    },
    destroy: modal.destroy,
  };
}
