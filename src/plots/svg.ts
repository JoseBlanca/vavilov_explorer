// What the plots drawn in SVG share, the histogram and the 2D scatter: how
// an element is made, and the room their axes take (docs/design.md,
// section 9).

const SVG = "http://www.w3.org/2000/svg";

/** The room around the marks of a plot for its axes and their names, in CSS pixels. */
export const AXES_MARGIN = { top: 18, right: 20, bottom: 52, left: 72 } as const;
/** The length of a tick of an axis, in CSS pixels. */
export const TICK_PX = 5;

/** An SVG element of `name`, with `attributes`. */
export function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Readonly<Record<string, string | number>>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}
