import { nothing, render } from "lit-html";

import { besidePointer } from "./besidePointer.ts";
import { textLabelView } from "./textLabel.view.ts";

/** A label of text beside the pointer, in its element: a country of the map of countries, a segment of a histogram. */
export interface TextLabel {
  /** Shows `text` beside `place`, in CSS pixels of the window. */
  readonly show: (text: string, place: { x: number; y: number }) => void;
  /** Hides the label. */
  readonly hide: () => void;
  /** Empties the element. */
  readonly destroy: () => void;
}

/**
 * The label in `element`, beside the pointer and kept inside the window;
 * what it shows is the component's own.
 */
export function createTextLabel(element: HTMLElement): TextLabel {
  const draw = (text: string | null, place: { x: number; y: number }): void => {
    render(textLabelView({ text, x: place.x, y: place.y }), element);
    const box = element.firstElementChild;
    if (text === null || !(box instanceof HTMLElement)) {
      return;
    }
    const { width, height } = box.getBoundingClientRect();
    render(
      textLabelView({
        text,
        ...besidePointer(place, width, height, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      }),
      element,
    );
  };
  return {
    show: draw,
    hide: () => {
      draw(null, { x: 0, y: 0 });
    },
    destroy: () => {
      render(nothing, element);
    },
  };
}
