import { defect } from "../../state/defect.ts";

/**
 * The element of `root` whose `data-slot` is `name`, which a window's frame
 * draws for one of its components.
 *
 * @throws A defect when the frame has no such slot.
 */
export function slot(root: HTMLElement, name: string): HTMLElement {
  const element = root.querySelector(`[data-slot="${name}"]`);
  if (!(element instanceof HTMLElement)) {
    throw defect(`a window without its slot ${name}`);
  }
  return element;
}
