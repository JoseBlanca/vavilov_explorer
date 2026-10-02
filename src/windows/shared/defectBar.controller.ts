import { nothing, render } from "lit-html";

import { defectBarView } from "./defectBar.view.ts";

/** The bar of a defect in its element, which shows the first defect it is given. */
export interface DefectBar {
  /** Shows the bar for `error`, unless it shows one already. */
  readonly show: (error: unknown) => void;
}

/**
 * The bar of a defect, in `element`, and the window's outermost handler of
 * errors: an error no code caught, and a promise whose failure nobody
 * handled, are shown there (.claude/skills/coding/typescript.md, "Errors").
 */
export function createDefectBar(element: HTMLElement, target: Window): DefectBar {
  let details: string | null = null;
  let copied = false;

  const draw = (): void => {
    if (details === null) {
      render(nothing, element);
      return;
    }
    render(defectBarView({ copied, onCopy: copy }), element);
  };

  const copy = (): void => {
    if (details === null) {
      return;
    }
    navigator.clipboard.writeText(details).then(
      () => {
        copied = true;
        draw();
      },
      (error: unknown) => {
        console.error("Vavilov Explorer: the technical details could not be copied", error);
      },
    );
  };

  const show = (error: unknown): void => {
    if (details !== null) {
      return;
    }
    details = describe(error);
    console.error(error);
    draw();
  };

  target.addEventListener("error", (event) => {
    show(event.error);
  });
  target.addEventListener("unhandledrejection", (event) => {
    show(event.reason);
  });
  return { show };
}

/** The technical details of an error, for a report. */
function describe(error: unknown): string {
  const lines = [`Vavilov Explorer, ${navigator.userAgent}`];
  if (error instanceof Error) {
    lines.push(error.message, error.stack ?? "");
  } else {
    lines.push(String(error));
  }
  return lines.join("\n");
}
