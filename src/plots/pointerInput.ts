// What the pointer does over the points of a plot, whether WebGL draws
// them, as in the 3D scatter and the maps, or SVG, as in the 2D scatter:
// the hover, a click on a point, and the lasso, drawn on a canvas of its
// own laid over the plot (frontend.md, "The point views";
// docs/prototype-lessons.md, "Interaction"). It knows where the points are
// only through its hooks.

import type { Click } from "../state/pointClick.ts";

import { at } from "../state/at.ts";
import { defect } from "../state/defect.ts";
import type { EditMode } from "../state/message.ts";
import { pointClickOf } from "../state/pointClick.ts";
import { platformOf } from "../state/undoKeys.ts";
import { pointsInPolygon } from "./projection.ts";
import type { ScreenPoints } from "./projection.ts";

/**
 * What the user does with the pointer over a point view. What the pointer
 * is over is the point of a row, or, in a view that picks something else,
 * as the map of countries picks a country, the number the view gives it.
 */
export interface PointViewEvents {
  /**
   * The pointer moved, over the point of `row` or over none, at `x`, `y` in
   * CSS pixels of the window; and with `null` and no place, it left the view.
   */
  readonly onHover: (row: number | null, place: { x: number; y: number } | null) => void;
  /** A click on the point of `row`, which selects it alone or toggles it in the selection. */
  readonly onClick: (row: number, click: Exclude<Click, "range">) => void;
  /**
   * The click just given to {@link onClick} was the first of a double
   * click, which frames the view and leaves the selection as it was: what
   * that click changed is put back. The second click is given to nothing.
   */
  readonly onClickUndone: () => void;
  /** A lasso drawn and released, with the points drawn inside it, one bit per row. */
  readonly onLasso: (rows: Uint8Array) => void;
  /** The lasso that waited was dropped, since the view moved. */
  readonly onLassoDropped: () => void;
  /** The system changed between light and dark: colours read from the theme are read again. */
  readonly onThemeChange: () => void;
}

/**
 * The lasso of a point view: off; armed by the button pressed, + or −, so
 * that a drag draws it; or drawn and waiting for Enter, which keeps it on
 * screen until the view moves.
 */
export type LassoState =
  | { readonly kind: "off" }
  | { readonly kind: "armed"; readonly mode: EditMode }
  | { readonly kind: "waiting"; readonly mode: EditMode };

/** Where the points are, which the pointer input asks of the plot. */
export interface PointerHooks {
  /** What is under `x`, `y`, in CSS pixels of the frame: a row, or what the view picks, or `null`. */
  readonly pick: (x: number, y: number) => number | null;
  /** Each point's place in CSS pixels of the frame, for the points inside a lasso. */
  readonly screen: () => ScreenPoints;
}

/** The pointer input of a plot, for the plot that made it. */
export interface PointerInput {
  /** Sets the state of the lasso; one drawn is cleared unless it waits or is being drawn. */
  readonly setLasso: (lasso: LassoState) => void;
  /**
   * The view moved under the pointer: a lasso drawn no longer fits the
   * points, and goes; the hover is picked again once the plot has drawn.
   */
  readonly viewMoved: () => void;
  /** The plot drew: a hover the view moved under is picked again where the pointer rests. */
  readonly drawn: () => void;
  /** The frame is `width` by `height` CSS pixels, drawn at `ratio` device pixels to one. */
  readonly resize: (width: number, height: number, ratio: number) => void;
  /** The colours of a lasso drawn with + and with −, as CSS writes them. */
  readonly setColours: (add: string, remove: string) => void;
  /** Removes its listeners and its canvas. */
  readonly destroy: () => void;
}

/** A press that moves less than this, in CSS pixels, is a click and not a drag. */
const CLICK_TOLERANCE_PX = 4;
/** The points of a lasso closer together than this, in CSS pixels, are dropped. */
const LASSO_STEP_PX = 3;

/** The place of the pointer of `event` in CSS pixels of `frame`. */
export function placeOnFrame(frame: HTMLElement, event: MouseEvent): { x: number; y: number } {
  const rect = frame.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** The largest distance of a point of `path`, `x0, y0, x1, y1, …`, from its first. */
function spread(path: readonly number[]): number {
  const x0 = at(path, 0);
  const y0 = at(path, 1);
  let largest = 0;
  for (let index = 2; index + 1 < path.length; index += 2) {
    largest = Math.max(largest, Math.hypot(at(path, index) - x0, at(path, index + 1) - y0));
  }
  return largest;
}

/**
 * The pointer input of the points drawn in `frame`, with the lasso drawn on
 * a canvas it adds to the frame, over what the plot draws; the user's
 * actions go to `events`. A press that goes nowhere is a click on the point
 * under it; with + or − pressed, a drag draws a lasso, which waits for Enter
 * once released; with none, a drag is the plot's, which pans or rotates, and
 * shows no hover meanwhile. The hover is given up when the pointer leaves
 * the frame, and when the window loses the focus, since a window left for
 * another gets no pointer events on macOS (docs/design.md, section 10).
 */
export function createPointerInput(
  frame: HTMLElement,
  hooks: PointerHooks,
  events: PointViewEvents,
): PointerInput {
  const lassoCanvas = document.createElement("canvas");
  lassoCanvas.className = "plot-lasso";
  frame.append(lassoCanvas);
  const context = lassoCanvas.getContext("2d");
  if (context === null) {
    throw defect("a canvas with no 2D context for the lasso");
  }
  let width = 0;
  let height = 0;
  let lassoMode: EditMode | null = null;
  let lassoPath: number[] = [];
  let drawing = false;
  let press: { x: number; y: number } | null = null;
  // The click on a point that the press just released makes, given when
  // the browser counts it, and whether the last click counted 1 was given.
  let pending: { row: number; click: Exclude<Click, "range"> } | null = null;
  let lastGiven = false;
  const platform = platformOf(navigator.userAgent);
  // Where the pointer rests over the view with no button down, in CSS pixels
  // of the frame and of the window, or `null`; and whether the view moved
  // since the hover was picked there.
  let resting: { x: number; y: number; clientX: number; clientY: number } | null = null;
  let hoverMoved = false;
  let colours: { add: string; remove: string } | null = null;

  const drawLasso = (): void => {
    const ratio = lassoCanvas.width / Math.max(width, 1);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (lassoPath.length < 4 || lassoMode === null) {
      return;
    }
    if (colours === null) {
      throw defect("a lasso drawn before the theme was read");
    }
    context.beginPath();
    context.moveTo(at(lassoPath, 0), at(lassoPath, 1));
    for (let index = 2; index + 1 < lassoPath.length; index += 2) {
      context.lineTo(at(lassoPath, index), at(lassoPath, index + 1));
    }
    context.setLineDash([6, 4]);
    context.lineWidth = 2;
    context.strokeStyle = lassoMode === "add" ? colours.add : colours.remove;
    if (!drawing) {
      context.closePath();
    }
    context.stroke();
  };

  const clearLasso = (): void => {
    lassoPath = [];
    drawing = false;
    drawLasso();
  };

  const local = (event: PointerEvent): { x: number; y: number } => placeOnFrame(frame, event);

  // Only the first finger on a touch screen points; the others are the
  // view's, as two fingers zoom a map.
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    const place = local(event);
    press = place;
    pending = null;
    if (lassoMode !== null) {
      lassoPath = [place.x, place.y];
      drawing = true;
      drawLasso();
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!event.isPrimary) {
      return;
    }
    const place = local(event);
    if (drawing) {
      const lastX = at(lassoPath, lassoPath.length - 2);
      const lastY = at(lassoPath, lassoPath.length - 1);
      if (Math.hypot(place.x - lastX, place.y - lastY) >= LASSO_STEP_PX) {
        lassoPath.push(place.x, place.y);
        drawLasso();
      }
      return;
    }
    if (event.buttons !== 0) {
      // The view is being dragged: no hover meanwhile.
      resting = null;
      return;
    }
    resting = { ...place, clientX: event.clientX, clientY: event.clientY };
    hoverMoved = false;
    events.onHover(hooks.pick(place.x, place.y), { x: event.clientX, y: event.clientY });
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || press === null || !event.isPrimary) {
      return;
    }
    const place = local(event);
    const start = press;
    press = null;
    // A lasso closes where it started, so a press is a click when the
    // pointer went nowhere between, not when it ends where it began.
    const moved = drawing ? spread(lassoPath) : Math.hypot(place.x - start.x, place.y - start.y);
    if (moved < CLICK_TOLERANCE_PX) {
      if (drawing) {
        clearLasso();
      }
      const row = hooks.pick(place.x, place.y);
      const click = pointClickOf(event, platform);
      if (row !== null && click !== "none") {
        pending = { row, click };
      }
      return;
    }
    if (drawing) {
      drawing = false;
      if (lassoPath.length < 6) {
        clearLasso();
        return;
      }
      drawLasso();
      events.onLasso(pointsInPolygon(hooks.screen(), lassoPath));
    }
  };

  // The browser counts the clicks of a double click, 1 and then 2, in the
  // click that follows each release: the first acts, and the second takes
  // it back, so that a double click on a point leaves the selection as it
  // was (decided by the owner on 5 October 2026).
  const onClickCounted = (event: MouseEvent): void => {
    const given = pending;
    pending = null;
    if (event.detail >= 2) {
      if (lastGiven) {
        lastGiven = false;
        events.onClickUndone();
      }
      return;
    }
    lastGiven = given !== null;
    if (given !== null) {
      events.onClick(given.row, given.click);
    }
  };

  // The system took the pointer, as a web view does with a touch it reads
  // as a scroll: the lasso being drawn is dropped, and so is the press.
  const onPointerCancel = (): void => {
    press = null;
    pending = null;
    if (drawing) {
      clearLasso();
    }
  };

  const onWindowBlur = (): void => {
    if (resting !== null && !drawing) {
      resting = null;
      events.onHover(null, null);
    }
  };

  const onPointerLeave = (): void => {
    resting = null;
    if (!drawing) {
      events.onHover(null, null);
    }
  };

  frame.addEventListener("pointerdown", onPointerDown);
  frame.addEventListener("pointermove", onPointerMove);
  frame.addEventListener("pointerup", onPointerUp);
  frame.addEventListener("pointerleave", onPointerLeave);
  frame.addEventListener("pointercancel", onPointerCancel);
  frame.addEventListener("click", onClickCounted);
  window.addEventListener("blur", onWindowBlur);

  let destroyed = false;
  return {
    setLasso: (lasso) => {
      const mode = lasso.kind === "off" ? null : lasso.mode;
      const waiting = lasso.kind === "waiting";
      lassoMode = mode;
      frame.classList.toggle("plot-lasso-armed", mode !== null);
      if (mode === null || (!waiting && !drawing)) {
        clearLasso();
      }
    },
    viewMoved: () => {
      hoverMoved = true;
      if (!drawing && lassoPath.length > 0) {
        clearLasso();
        events.onLassoDropped();
      }
    },
    drawn: () => {
      if (hoverMoved && resting !== null) {
        // The points moved under a pointer that did not.
        hoverMoved = false;
        events.onHover(hooks.pick(resting.x, resting.y), {
          x: resting.clientX,
          y: resting.clientY,
        });
      }
    },
    resize: (newWidth, newHeight, ratio) => {
      width = newWidth;
      height = newHeight;
      lassoCanvas.width = Math.round(width * ratio);
      lassoCanvas.height = Math.round(height * ratio);
      drawLasso();
    },
    setColours: (add, remove) => {
      colours = { add, remove };
      drawLasso();
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      frame.removeEventListener("pointerdown", onPointerDown);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerup", onPointerUp);
      frame.removeEventListener("pointerleave", onPointerLeave);
      frame.removeEventListener("pointercancel", onPointerCancel);
      frame.removeEventListener("click", onClickCounted);
      window.removeEventListener("blur", onWindowBlur);
      lassoCanvas.remove();
    },
  };
}
