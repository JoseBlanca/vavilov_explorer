import { nothing, render } from "lit-html";

import { noticeView } from "./notice.view.ts";

/** The notice of the window in its element. */
export interface Notice {
  /** Shows `text`, in the place of the notice there was. */
  readonly show: (text: string) => void;
  /** Takes away the notice there is, if any. */
  readonly clear: () => void;
  /** Empties the element. */
  readonly destroy: () => void;
}

/**
 * The notice of the window, in `element`: it keeps its text until the user
 * dismisses it, and then gives the focus back to where it was when the
 * notice appeared, or, when that is no longer in the window, to `refocus`.
 */
export function createNotice(element: HTMLElement, refocus: () => void): Notice {
  let shown: { readonly text: string; readonly focus: Element | null } | null = null;
  const draw = (): void => {
    render(
      noticeView({
        text: shown?.text ?? null,
        onDismiss: () => {
          const focus = shown?.focus ?? null;
          shown = null;
          draw();
          if (focus instanceof HTMLElement && focus !== document.body && focus.isConnected) {
            focus.focus();
          } else {
            refocus();
          }
        },
      }),
      element,
    );
  };
  draw();
  return {
    show: (text) => {
      shown = { text, focus: document.activeElement };
      draw();
    },
    clear: () => {
      shown = null;
      draw();
    },
    destroy: () => {
      shown = null;
      render(nothing, element);
    },
  };
}
