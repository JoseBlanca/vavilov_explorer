// The opening and closing of a modal dialog, shared by the dialogs of the
// windows: the element it is drawn in, what it shows, the promise of the
// user's answer, and the focus given back when it closes.

import { nothing, render } from "lit-html";
import type { TemplateResult } from "lit-html";

import { defect } from "../../state/defect.ts";

/** What a dialog's view is given to draw what it shows and to answer. */
export interface ModalDraw<C, A> {
  /** What the dialog shows, or `null` while it is closed. */
  readonly content: C | null;
  /** Closes the dialog with `answer`. */
  readonly answer: (answer: A) => void;
  /** Shows `content` in the place of what the dialog shows, as the user changes it. */
  readonly change: (content: C) => void;
}

/** A modal dialog in its element, which shows a `C` and is answered with an `A`. */
export interface Modal<C, A> {
  /**
   * Shows `content` and resolves with the user's answer. What the dialog
   * showed before is answered as dismissed. When `withdrawn` aborts while
   * the dialog still shows `content`, it closes as dismissed.
   */
  readonly show: (content: C, withdrawn?: AbortSignal) => Promise<A>;
  /** Answers what it shows as dismissed and empties the element. */
  readonly destroy: () => void;
}

/**
 * A modal dialog in `element`, drawn by `view`, whose answer is `dismissed`
 * when the user closes it without choosing, when another content takes its
 * place, or when it is withdrawn. It opens with `showModal`, which takes
 * the focus, and gives the focus back to where it was when it opened, when
 * that is still in the window. `name` says which dialog it is in a defect.
 */
export function createModal<C, A>(
  element: HTMLElement,
  name: string,
  view: (draw: ModalDraw<C, A>) => TemplateResult,
  dismissed: A,
): Modal<C, A> {
  let open: {
    content: C;
    readonly resolve: (answer: A) => void;
    readonly focus: Element | null;
    readonly stop: () => void;
  } | null = null;

  const dialog = (): HTMLDialogElement => {
    const found = element.querySelector("dialog");
    if (!(found instanceof HTMLDialogElement)) {
      throw defect(`the ${name} without its dialog element`);
    }
    return found;
  };

  const answer = (given: A): void => {
    const answered = open;
    if (answered === null) {
      return;
    }
    open = null;
    answered.stop();
    draw();
    if (answered.focus instanceof HTMLElement && answered.focus.isConnected) {
      answered.focus.focus();
    }
    answered.resolve(given);
  };

  const change = (content: C): void => {
    if (open !== null) {
      open.content = content;
      draw();
    }
  };

  const draw = (): void => {
    render(view({ content: open?.content ?? null, answer, change }), element);
    const shown = dialog();
    if (open !== null && !shown.open) {
      shown.showModal();
    } else if (open === null && shown.open) {
      shown.close();
    }
  };

  draw();
  return {
    show: (content, withdrawn) => {
      answer(dismissed);
      return new Promise((resolve) => {
        if (withdrawn?.aborted === true) {
          resolve(dismissed);
          return;
        }
        const withdraw = (): void => {
          if (open?.resolve === resolve) {
            answer(dismissed);
          }
        };
        withdrawn?.addEventListener("abort", withdraw);
        open = {
          content,
          resolve,
          focus: document.activeElement,
          stop: () => {
            withdrawn?.removeEventListener("abort", withdraw);
          },
        };
        draw();
      });
    },
    destroy: () => {
      answer(dismissed);
      render(nothing, element);
    },
  };
}
