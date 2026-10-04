// What the point views share, the 3D scatter and the maps: the
// renderer, the points, drawing on demand, the size of the canvas, the
// colours of the theme, the place of each point on the screen, and what the
// pointer does over them, hover, click and lasso (frontend.md, "The point
// views"; docs/prototype-lessons.md, "A shared base for point views"). A
// view knows nothing of the backend or of a window: it is given positions
// and a style, and tells its events.

import * as THREE from "three";

import { defect } from "../state/defect.ts";
import { at } from "../state/at.ts";
import type { EditMode } from "../state/message.ts";
import { rgbOf } from "../state/pointStyle.ts";
import type { PointStyle } from "../state/pointStyle.ts";
import { pointClickOf } from "../state/pointClick.ts";
import { hasRow } from "../state/rowSet.ts";
import { platformOf } from "../state/undoKeys.ts";
import { createPoints } from "./points.ts";
import { pickPoint, pointsInPolygon, projectPoints } from "./projection.ts";
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
  readonly onClick: (row: number, click: "select" | "toggle") => void;
  /** A lasso drawn and released, with the points drawn inside it, one bit per row. */
  readonly onLasso: (rows: Uint8Array) => void;
  /** The lasso that waited was dropped, since the camera moved. */
  readonly onLassoDropped: () => void;
  /** The system changed between light and dark: colours read from the theme are read again. */
  readonly onThemeChange: () => void;
}

/**
 * The lasso of a point view: off; armed by the button pressed, + or −, so
 * that a drag draws it; or drawn and waiting for Enter, which keeps it on
 * screen until the camera moves.
 */
export type LassoState =
  | { readonly kind: "off" }
  | { readonly kind: "armed"; readonly mode: EditMode }
  | { readonly kind: "waiting"; readonly mode: EditMode };

/** What a kind of point view gives the base: its camera, and what it does around each draw. */
export interface PointViewHooks {
  /** Readies the camera for a draw, and says whether it is still moving, as while it coasts. */
  readonly beforeDraw: () => boolean;
  /** Places what follows the camera, such as labels, after a draw. */
  readonly afterDraw: () => void;
  /** Fits the camera to a canvas of `width` by `height` CSS pixels. */
  readonly onResize: (width: number, height: number) => void;
  /** Takes the colours of the theme, read by `token` from the tokens of the CSS. */
  readonly onTheme: (token: (name: string) => string) => void;
  /** Moves the camera for a key pressed with no modifier, and says whether the key was one. */
  readonly onKey: (key: string) => boolean;
  /**
   * What is under `x`, `y`, in CSS pixels of the canvas, for a kind that
   * picks something other than the points, or `null` for the point nearest
   * the camera.
   */
  readonly pick: ((x: number, y: number) => number | null) | null;
}

/** The base of a point view, for the kind of view built on it. */
export interface PointViewBase {
  /** The scene the points are in, where the kind adds what else it draws. */
  readonly scene: THREE.Scene;
  /** The canvas, which the controls of the camera listen to. */
  readonly canvas: HTMLCanvasElement;
  /** Sets the positions, three per row in the scene. */
  readonly setPositions: (positions: Float32Array) => void;
  /** Sets the style of the points; a row not in `placed` is not drawn. */
  readonly setStyle: (style: PointStyle, placed: Uint8Array) => void;
  /** Sets the state of the lasso; one drawn is cleared unless it waits or is being drawn. */
  readonly setLasso: (lasso: LassoState) => void;
  /** Draws on the next frame; several requests in a frame make one draw. */
  readonly requestDraw: () => void;
  /** Names the view for a screen reader, which reads it as one image. */
  readonly setName: (name: string) => void;
  /** Where the camera moved: the drawn lasso no longer fits the points, and goes. */
  readonly cameraMoved: () => void;
  /** A place of the scene in CSS pixels of the canvas, or `null` when it is behind the camera. */
  readonly toCanvas: (point: THREE.Vector3) => { x: number; y: number } | null;
  /** The place of a row's point in CSS pixels of the window, or `null` when it is not drawn. */
  readonly placeOf: (row: number) => { x: number; y: number } | null;
  /** Removes everything it made from the element and frees the GPU. */
  readonly destroy: () => void;
}

/** The pointer reaches a point this many CSS pixels beyond its edge. */
const PICK_SLOP_PX = 3;
/** A press that moves less than this, in CSS pixels, is a click and not a drag. */
const CLICK_TOLERANCE_PX = 4;
/** The points of a lasso closer together than this, in CSS pixels, are dropped. */
const LASSO_STEP_PX = 3;
/** The most device pixels a CSS pixel is drawn with (frontend.md). */
const MAX_PIXEL_RATIO = 2;
/** The words shown over a view whose drawing the graphics card dropped (docs/design.md, section 12). */
const LOST_WORDS = "The 3D view was lost by the graphics card and is being restored.";

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
 * The base of a point view in `element`, which it fills, seen through
 * `camera`, with the `hooks` of its kind and `labels`, the kind's layer of
 * text that follows the camera, laid over the canvas; the user's actions go
 * to `events`. It reads the theme as it is made, so the hooks must be ready.
 */
export function createPointView(
  element: HTMLElement,
  camera: THREE.Camera,
  hooks: PointViewHooks,
  labels: HTMLElement,
  events: PointViewEvents,
): PointViewBase {
  const frame = document.createElement("div");
  frame.className = "plot-frame";
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const canvas = renderer.domElement;
  canvas.className = "plot-canvas";
  // One control to the keyboard and to a screen reader, named by the kind,
  // whose keys move the camera; its data is reachable in the main window's
  // table. Not the frame, whose message of a lost drawing a screen reader
  // must still read.
  canvas.setAttribute("role", "application");
  canvas.tabIndex = 0;
  const lassoCanvas = document.createElement("canvas");
  lassoCanvas.className = "plot-lasso";
  const lost = document.createElement("p");
  lost.className = "plot-lost";
  lost.setAttribute("role", "status");
  frame.append(canvas, labels, lassoCanvas, lost);
  element.append(frame);
  const context = lassoCanvas.getContext("2d");
  if (context === null) {
    throw defect("a canvas with no 2D context for the lasso");
  }

  const scene = new THREE.Scene();
  const points = createPoints();
  scene.add(points.object);
  let positions: Float32Array = new Float32Array(0);
  let sizes: Float32Array = new Float32Array(0);
  let screen: ScreenPoints | null = null;
  let frameRequest = 0;
  let width = 0;
  let height = 0;
  let lassoMode: EditMode | null = null;
  let lassoPath: number[] = [];
  let drawing = false;
  let press: { x: number; y: number } | null = null;
  let lostShown = false;
  const platform = platformOf(navigator.userAgent);
  // Where the pointer rests over the view with no button down, in CSS pixels
  // of the canvas and of the window, or `null`; and whether the camera moved
  // since the hover was picked there.
  let resting: { x: number; y: number; clientX: number; clientY: number } | null = null;
  let hoverMoved = false;
  // Read from the theme as the view is made, before anything is drawn.
  let lassoColours: { add: string; remove: string } | null = null;

  const project = (): ScreenPoints => {
    if (screen === null) {
      camera.updateMatrixWorld();
      const matrix = new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      screen = projectPoints(matrix.elements, positions, sizes, width, height);
    }
    return screen;
  };

  const draw = (): void => {
    frameRequest = 0;
    if (width === 0 || height === 0) {
      return;
    }
    const moving = hooks.beforeDraw();
    renderer.render(scene, camera);
    screen = null;
    hooks.afterDraw();
    if (hoverMoved && resting !== null) {
      // The points moved under a pointer that did not.
      hoverMoved = false;
      events.onHover(pick(resting.x, resting.y), { x: resting.clientX, y: resting.clientY });
    }
    if (lostShown && !renderer.getContext().isContextLost()) {
      lostShown = false;
      lost.textContent = "";
    }
    if (moving) {
      requestDraw();
    }
  };

  const requestDraw = (): void => {
    if (frameRequest === 0) {
      frameRequest = requestAnimationFrame(draw);
    }
  };

  const drawLasso = (): void => {
    const ratio = lassoCanvas.width / Math.max(width, 1);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (lassoPath.length < 4 || lassoMode === null) {
      return;
    }
    if (lassoColours === null) {
      throw defect("a lasso drawn before the theme was read");
    }
    const colour = lassoMode === "add" ? lassoColours.add : lassoColours.remove;
    context.beginPath();
    context.moveTo(at(lassoPath, 0), at(lassoPath, 1));
    for (let index = 2; index + 1 < lassoPath.length; index += 2) {
      context.lineTo(at(lassoPath, index), at(lassoPath, index + 1));
    }
    context.setLineDash([6, 4]);
    context.lineWidth = 2;
    context.strokeStyle = colour;
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

  const resize = (): void => {
    const rect = frame.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (width === 0 || height === 0) {
      return;
    }
    const ratio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    points.setPixelRatio(ratio);
    lassoCanvas.width = Math.round(width * ratio);
    lassoCanvas.height = Math.round(height * ratio);
    hooks.onResize(width, height);
    screen = null;
    drawLasso();
    requestDraw();
  };

  const readTheme = (): void => {
    const style = getComputedStyle(element);
    const token = (name: string): string => {
      const value = style.getPropertyValue(name).trim();
      if (value === "") {
        throw defect(`no token ${name} for a point view`);
      }
      return value;
    };
    const surface = token("--color-surface");
    renderer.setClearColor(surface);
    lassoColours = { add: token("--color-add-surface"), remove: token("--color-remove-surface") };
    points.setColours({
      // The edge of every point stands out from the background, whatever its
      // group's colour (docs/design.md, section 2.2).
      ring: rgbOf(token("--color-control-border")),
      marked: rgbOf(token("--color-text")),
      lassoAdd: rgbOf(lassoColours.add),
      lassoRemove: rgbOf(lassoColours.remove),
    });
    hooks.onTheme(token);
    drawLasso();
    requestDraw();
  };

  /** A place of the pointer in CSS pixels of the canvas. */
  const local = (event: PointerEvent): { x: number; y: number } => {
    const rect = frame.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pick = (x: number, y: number): number | null =>
    hooks.pick === null ? pickPoint(project(), sizes, x, y, PICK_SLOP_PX) : hooks.pick(x, y);

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const place = local(event);
    press = place;
    if (lassoMode !== null) {
      // The controls of the camera, which cannot rotate meanwhile, capture
      // the pointer on the canvas, so a lasso dragged out of the frame
      // still reaches it.
      lassoPath = [place.x, place.y];
      drawing = true;
      drawLasso();
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
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
      // The camera is being dragged: no hover meanwhile.
      resting = null;
      return;
    }
    resting = { ...place, clientX: event.clientX, clientY: event.clientY };
    hoverMoved = false;
    events.onHover(pick(place.x, place.y), { x: event.clientX, y: event.clientY });
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || press === null) {
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
      const row = pick(place.x, place.y);
      const click = pointClickOf(event, platform);
      if (row !== null && click !== "none") {
        events.onClick(row, click);
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
      events.onLasso(pointsInPolygon(project(), lassoPath));
    }
  };

  // The system took the pointer, as a web view does with a touch it reads
  // as a scroll: the lasso being drawn is dropped, and so is the press.
  const onPointerCancel = (): void => {
    press = null;
    if (drawing) {
      clearLasso();
    }
  };

  // A window left for another, as with Cmd-Tab, gets no pointer events on
  // macOS (docs/design.md, section 10), so its hover would stay: it is given
  // up with the focus.
  const onWindowBlur = (): void => {
    if (resting !== null && !drawing) {
      resting = null;
      events.onHover(null, null);
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) {
      return;
    }
    if (hooks.onKey(event.key)) {
      event.preventDefault();
    }
  };

  const onSchemeChange = (): void => {
    readTheme();
    events.onThemeChange();
  };

  const onPointerLeave = (): void => {
    resting = null;
    if (!drawing) {
      events.onHover(null, null);
    }
  };

  const onContextLost = (event: Event): void => {
    // Without it the browser does not restore the context.
    event.preventDefault();
    lostShown = true;
    lost.textContent = LOST_WORDS;
  };

  const onContextRestored = (): void => {
    requestDraw();
  };

  // A window moved to a screen of another density keeps its size, so the
  // observer does not see it: a query of the density does, and is asked
  // again for the new one each time it changes.
  let density: MediaQueryList | null = null;
  const onDensityChange = (): void => {
    watchDensity();
    resize();
  };
  const watchDensity = (): void => {
    density?.removeEventListener("change", onDensityChange);
    density = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    density.addEventListener("change", onDensityChange);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(frame);
  watchDensity();
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", onSchemeChange);
  frame.addEventListener("pointerdown", onPointerDown);
  frame.addEventListener("pointermove", onPointerMove);
  frame.addEventListener("pointerup", onPointerUp);
  frame.addEventListener("pointerleave", onPointerLeave);
  frame.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("blur", onWindowBlur);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  readTheme();

  let destroyed = false;
  return {
    scene,
    canvas,
    setPositions: (given) => {
      positions = given;
      points.setPositions(given);
      screen = null;
      requestDraw();
    },
    setStyle: (style, placed) => {
      sizes = style.sizes.map((size, row) => (hasRow(placed, row) ? size : 0));
      points.setStyle({ ...style, sizes });
      screen = null;
      requestDraw();
    },
    setLasso: (lasso) => {
      const mode = lasso.kind === "off" ? null : lasso.mode;
      const waiting = lasso.kind === "waiting";
      lassoMode = mode;
      frame.classList.toggle("plot-lasso-armed", mode !== null);
      if (mode === null || (!waiting && !drawing)) {
        clearLasso();
      }
    },
    requestDraw,
    setName: (name) => {
      canvas.setAttribute("aria-label", name);
    },
    cameraMoved: () => {
      screen = null;
      hoverMoved = true;
      if (!drawing && lassoPath.length > 0) {
        clearLasso();
        events.onLassoDropped();
      }
      requestDraw();
    },
    toCanvas: (point) => {
      const clip = point.clone().project(camera);
      if (clip.z > 1) {
        return null;
      }
      return { x: ((clip.x + 1) / 2) * width, y: ((1 - clip.y) / 2) * height };
    },
    placeOf: (row) => {
      const x = project().xy[2 * row];
      const y = project().xy[2 * row + 1];
      if (x === undefined || y === undefined || Number.isNaN(x)) {
        return null;
      }
      const rect = frame.getBoundingClientRect();
      return { x: rect.left + x, y: rect.top + y };
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      cancelAnimationFrame(frameRequest);
      observer.disconnect();
      density?.removeEventListener("change", onDensityChange);
      scheme.removeEventListener("change", onSchemeChange);
      frame.removeEventListener("pointerdown", onPointerDown);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerup", onPointerUp);
      frame.removeEventListener("pointerleave", onPointerLeave);
      frame.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onWindowBlur);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      points.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      frame.remove();
    },
  };
}
