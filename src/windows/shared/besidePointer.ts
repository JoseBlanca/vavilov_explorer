/** The gap between the pointer and a label beside it, in CSS pixels. */
const GAP_PX = 14;

/**
 * Where a label of `width` by `height` CSS pixels goes beside the pointer at
 * `place`, in CSS pixels of a window of `size`: below it and to its right,
 * or on its other side near the window's edges, and kept inside the window.
 */
export function besidePointer(
  place: { readonly x: number; readonly y: number },
  width: number,
  height: number,
  size: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  const flipped = place.x + GAP_PX + width > size.width;
  const x = Math.max(0, flipped ? place.x - GAP_PX - width : place.x + GAP_PX);
  const y = Math.max(0, Math.min(place.y + GAP_PX, size.height - height));
  return { x, y };
}
