// What the point views drawn with WebGL share, the 3D scatter and the
// maps: the renderer, the points, drawing on demand, the size of the
// canvas, the colours of the theme and the place of each point on the
// screen; what the pointer does over them, hover, click and lasso, is
// pointerInput.ts's (frontend.md, "The point views";
// docs/prototype-lessons.md, "A shared base for point views"). A view
// knows nothing of the backend or of a window: it is given positions and a
// style, and tells its events.

import * as THREE from "three";

import { defect } from "../state/defect.ts";
import { rgbOf } from "../state/pointStyle.ts";
import type { PointStyle } from "../state/pointStyle.ts";
import { hasRow } from "../state/rowSet.ts";
import { createPointerInput } from "./pointerInput.ts";
import type { LassoState, PointViewEvents } from "./pointerInput.ts";
import { createPoints } from "./points.ts";
import { PICK_SLOP_PX, pickPoint, projectPoints } from "./projection.ts";
import { pixelRatio, watchDensity } from "./screenDensity.ts";
import type { ScreenPoints } from "./projection.ts";

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
  /**
   * The points moved on the screen, as the camera moved or their places
   * changed: the drawn lasso no longer fits them, and goes, and the hover
   * is picked again where the pointer rests.
   */
  readonly pointsMoved: () => void;
  /** A place of the scene in CSS pixels of the canvas, or `null` when it is behind the camera. */
  readonly toCanvas: (point: THREE.Vector3) => { x: number; y: number } | null;
  /** The place of a row's point in CSS pixels of the window, or `null` when it is not drawn. */
  readonly placeOf: (row: number) => { x: number; y: number } | null;
  /** Removes everything it made from the element and frees the GPU. */
  readonly destroy: () => void;
}

/** The words shown over a view whose drawing the graphics card dropped (docs/design.md, section 12). */
const LOST_WORDS = "The 3D view was lost by the graphics card and is being restored.";

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
  frame.append(canvas, labels);
  element.append(frame);

  const scene = new THREE.Scene();
  const points = createPoints();
  scene.add(points.object);
  let positions: Float32Array = new Float32Array(0);
  let sizes: Float32Array = new Float32Array(0);
  let screen: ScreenPoints | null = null;
  let frameRequest = 0;
  let width = 0;
  let height = 0;
  let lostShown = false;

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

  const pick = (x: number, y: number): number | null =>
    hooks.pick === null ? pickPoint(project(), sizes, x, y, PICK_SLOP_PX) : hooks.pick(x, y);

  // The controls of the camera, which cannot rotate while + or − is
  // pressed, capture the pointer on the canvas, so a lasso dragged out of
  // the frame still reaches it.
  const input = createPointerInput(frame, { pick, screen: project }, events);
  const lost = document.createElement("p");
  lost.className = "plot-lost";
  lost.setAttribute("role", "status");
  frame.append(lost);

  const draw = (): void => {
    frameRequest = 0;
    if (width === 0 || height === 0) {
      return;
    }
    const moving = hooks.beforeDraw();
    renderer.render(scene, camera);
    screen = null;
    hooks.afterDraw();
    input.drawn();
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

  const resize = (): void => {
    const rect = frame.getBoundingClientRect();
    const moved = rect.width !== width || rect.height !== height;
    width = rect.width;
    height = rect.height;
    if (width === 0 || height === 0) {
      return;
    }
    const ratio = pixelRatio();
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    points.setPixelRatio(ratio);
    input.resize(width, height, ratio);
    hooks.onResize(width, height);
    screen = null;
    if (moved) {
      // The points moved on the screen, under the lasso and the pointer.
      input.viewMoved();
    }
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
    const lassoAdd = token("--color-add-surface");
    const lassoRemove = token("--color-remove-surface");
    input.setColours(lassoAdd, lassoRemove);
    points.setColours({
      // The edge of every point stands out from the background, whatever its
      // group's colour (docs/design.md, section 2.2).
      ring: rgbOf(token("--color-control-border")),
      marked: rgbOf(token("--color-text")),
      lassoAdd: rgbOf(lassoAdd),
      lassoRemove: rgbOf(lassoRemove),
    });
    hooks.onTheme(token);
    requestDraw();
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

  const onContextLost = (event: Event): void => {
    // Without it the browser does not restore the context.
    event.preventDefault();
    lostShown = true;
    lost.textContent = LOST_WORDS;
  };

  const onContextRestored = (): void => {
    requestDraw();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(frame);
  const unwatchDensity = watchDensity(resize);
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", onSchemeChange);
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
    setLasso: input.setLasso,
    requestDraw,
    setName: (name) => {
      canvas.setAttribute("aria-label", name);
    },
    pointsMoved: () => {
      screen = null;
      input.viewMoved();
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
      unwatchDensity();
      scheme.removeEventListener("change", onSchemeChange);
      input.destroy();
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
