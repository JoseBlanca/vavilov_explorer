// The flat map the two maps share, on the base of the point views: the
// world in Web Mercator under an orthographic camera looking straight
// down, its borders drawn under the data, and the camera's pan and zoom by
// the pointer and the keys (frontend.md, "The point views";
// docs/prototype-lessons.md, "Map").

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { at } from "../state/at.ts";
import { createPointView } from "./pointView.ts";
import type { PointViewBase, PointViewEvents } from "./pointView.ts";
import { theWorld } from "./world.ts";
import type { Box } from "./worldShapes.ts";
import "./plots.css";

/** What a kind of map adds to the flat map. */
export interface FlatMapHooks {
  /** Takes the colours of the theme, read by `token` from the tokens of the CSS. */
  readonly onTheme: (token: (name: string) => string) => void;
  /** Fits what the kind draws in pixels to a canvas of `width` by `height` CSS pixels. */
  readonly onResize: (width: number, height: number) => void;
  /**
   * What is under the place `x`, `y` of the scene, for a kind that picks
   * something other than the points, or `null` for the point under the
   * pointer.
   */
  readonly pick: ((x: number, y: number) => number | null) | null;
}

/** The flat map, for the kind of map built on it. */
export interface FlatMap {
  /** The base of the point views, whose scene the kind adds to. */
  readonly base: PointViewBase;
  /** Sets the part of the world Home and a double click frame, and frames it the first time. */
  readonly setHome: (box: Box) => void;
  /** Lets a drag pan the map, or not, while it draws a lasso; the wheel zooms either way. */
  readonly setPanning: (panning: boolean) => void;
  /** The place of the scene `x`, `y` in CSS pixels of the window. */
  readonly toWindow: (x: number, y: number) => { x: number; y: number };
  /** Gives the map the keyboard's focus. */
  readonly focus: () => void;
  /** Removes it from its element and frees the GPU. */
  readonly destroy: () => void;
}

/** How high the camera looks down from, in units of the scene, above all it draws. */
const CAMERA_HEIGHT = 10;
/** The share of the view, from its centre to each edge, the framed box fills. */
const FILL = 0.9;
/**
 * The least width and height a framed box is given, in units of the scene,
 * about 9° of longitude, so that a single place, or a few close together,
 * are shown with the land around them.
 */
const MIN_SPAN = 0.05;
/** How far the map can be zoomed out and in, against the world filling the view's height. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5000;
/** How far an arrow key moves the map, as a share of the view. */
const KEY_PAN = 0.1;
/** How many times nearer + brings the map, and − takes it further. */
const KEY_ZOOM = 1.25;
/** How much of its speed the map keeps after a drag, as the 3D scatter. */
const DAMPING = 0.12;

/**
 * A flat map in `element`, which it fills, with the `hooks` of its kind;
 * the user's actions go to `events`. A drag pans, the wheel zooms where
 * the pointer is, a double click frames the home box again; with the
 * keyboard's focus on it, the arrows pan, + and − zoom, and Home frames the
 * home box again.
 */
export function createFlatMap(
  element: HTMLElement,
  events: PointViewEvents,
  hooks: FlatMapHooks,
): FlatMap {
  // The view is 2 units high at zoom 1, and as wide as the canvas's shape.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2 * CAMERA_HEIGHT);
  camera.position.set(0, 0, CAMERA_HEIGHT);
  camera.lookAt(0, 0, 0);
  let width = 0;
  let height = 0;
  let home: Box | null = null;
  let framed = false;

  // Made before the base, which reads the theme as it is made.
  const world = theWorld();
  const borderGeometry = new THREE.BufferGeometry();
  const segments = world.borders;
  const positions = new Float32Array((segments.length / 2) * 3);
  for (let index = 0; 2 * index < segments.length; index += 1) {
    positions[3 * index] = at(segments, 2 * index);
    positions[3 * index + 1] = at(segments, 2 * index + 1);
  }
  borderGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const borderMaterial = new THREE.LineBasicMaterial({ depthWrite: false });
  const borders = new THREE.LineSegments(borderGeometry, borderMaterial);
  // Under every point, which it does not hide (frontend.md).
  borders.renderOrder = -1;
  borders.frustumCulled = false;

  const labels = document.createElement("div");
  labels.className = "plot-labels";
  const made: { controls: OrbitControls | null; onKey: (key: string) => boolean } = {
    controls: null,
    onKey: () => false,
  };

  /** The place `x`, `y` of the canvas, in CSS pixels, in the scene. */
  const toScene = (x: number, y: number): { x: number; y: number } => {
    const halfWidth = (camera.right - camera.left) / 2 / camera.zoom;
    const halfHeight = (camera.top - camera.bottom) / 2 / camera.zoom;
    return {
      x: camera.position.x + ((2 * x) / width - 1) * halfWidth,
      y: camera.position.y + (1 - (2 * y) / height) * halfHeight,
    };
  };

  const pickInScene = hooks.pick;
  const base = createPointView(
    element,
    camera,
    {
      beforeDraw: () => made.controls?.update() ?? false,
      afterDraw: () => undefined,
      onResize: (newWidth, newHeight) => {
        width = newWidth;
        height = newHeight;
        const aspect = width / height;
        camera.left = -aspect;
        camera.right = aspect;
        camera.updateProjectionMatrix();
        hooks.onResize(width, height);
        if (!framed && home !== null) {
          frame(home);
        }
      },
      onTheme: (token) => {
        borderMaterial.color.set(token("--color-control-border"));
        hooks.onTheme(token);
      },
      onKey: (key) => made.onKey(key),
      pick:
        pickInScene === null
          ? null
          : (x, y) => {
              const place = toScene(x, y);
              return pickInScene(place.x, place.y);
            },
    },
    labels,
    events,
  );
  base.scene.add(borders);

  const controls = new OrbitControls(camera, base.canvas);
  made.controls = controls;
  controls.enableRotate = false;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.minZoom = MIN_ZOOM;
  controls.maxZoom = MAX_ZOOM;
  controls.enableDamping = true;
  controls.dampingFactor = DAMPING;
  const onChange = (): void => {
    base.cameraMoved();
  };
  controls.addEventListener("change", onChange);

  /** Looks at `box` from above, as near as fits it within FILL of the view. */
  const frame = (box: Box): void => {
    if (width === 0 || height === 0) {
      return;
    }
    const boxWidth = Math.max(box.maxX - box.minX, MIN_SPAN);
    const boxHeight = Math.max(box.maxY - box.minY, MIN_SPAN);
    const centreX = (box.minX + box.maxX) / 2;
    const centreY = (box.minY + box.maxY) / 2;
    camera.zoom = THREE.MathUtils.clamp(
      FILL *
        Math.min((camera.right - camera.left) / boxWidth, (camera.top - camera.bottom) / boxHeight),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    camera.position.set(centreX, centreY, CAMERA_HEIGHT);
    controls.target.set(centreX, centreY, 0);
    camera.updateProjectionMatrix();
    controls.update();
    framed = true;
    base.cameraMoved();
  };

  const frameHome = (): void => {
    if (home !== null) {
      frame(home);
    }
  };

  /** Moves the map by `dx`, `dy` shares of the view's width and height. */
  const pan = (dx: number, dy: number): void => {
    const x = (dx * (camera.right - camera.left)) / camera.zoom;
    const y = (dy * (camera.top - camera.bottom)) / camera.zoom;
    camera.position.x += x;
    camera.position.y += y;
    controls.target.x += x;
    controls.target.y += y;
    controls.update();
    base.cameraMoved();
  };

  const zoom = (factor: number): void => {
    camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    camera.updateProjectionMatrix();
    controls.update();
    base.cameraMoved();
  };

  made.onKey = (key) => {
    switch (key) {
      case "ArrowLeft":
        pan(-KEY_PAN, 0);
        return true;
      case "ArrowRight":
        pan(KEY_PAN, 0);
        return true;
      case "ArrowUp":
        pan(0, KEY_PAN);
        return true;
      case "ArrowDown":
        pan(0, -KEY_PAN);
        return true;
      case "+":
      case "=":
        zoom(KEY_ZOOM);
        return true;
      case "-":
      case "−":
        zoom(1 / KEY_ZOOM);
        return true;
      case "Home":
        frameHome();
        return true;
      default:
        return false;
    }
  };
  base.canvas.addEventListener("dblclick", frameHome);

  let destroyed = false;
  return {
    base,
    setHome: (box) => {
      home = box;
      if (!framed) {
        frame(box);
      }
    },
    setPanning: (panning) => {
      controls.enablePan = panning;
    },
    toWindow: (x, y) => {
      const halfWidth = (camera.right - camera.left) / 2 / camera.zoom;
      const halfHeight = (camera.top - camera.bottom) / 2 / camera.zoom;
      const rect = base.canvas.getBoundingClientRect();
      return {
        x: rect.left + ((x - camera.position.x) / halfWidth + 1) * (width / 2),
        y: rect.top + (1 - (y - camera.position.y) / halfHeight) * (height / 2),
      };
    },
    focus: () => {
      base.canvas.focus();
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      base.canvas.removeEventListener("dblclick", frameHome);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      borderGeometry.dispose();
      borderMaterial.dispose();
      base.destroy();
    },
  };
}
