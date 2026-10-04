// The 3D scatter: the points of three numeric columns in a box with its
// axes, seen by a camera that orbits it, on the base the point views share
// (frontend.md, "The point views"; the prototype's src/scatter/scatter_plot.ts).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { defect } from "../state/defect.ts";
import { at } from "../state/at.ts";
import type { Placed } from "../state/placed.ts";
import type { PointStyle } from "../state/pointStyle.ts";
import { rangeOf, sceneMaps } from "./axes.ts";
import type { AxisMap } from "./axes.ts";
import { createAxesView } from "./axesView.ts";
import { framingDistance } from "./framing.ts";
import { createPointView } from "./pointView.ts";
import "./plots.css";
import { KEY_ZOOM } from "./viewKeys.ts";
import type { LassoState, PointViewEvents } from "./pointerInput.ts";

/** What a 3D scatter draws. */
export interface Scatter3dData {
  /**
   * The values on the x, y and z axes, one per row of the table, each its
   * distance from the axis's centre in `centres`.
   */
  readonly values: readonly [Float32Array, Float32Array, Float32Array];
  /** The middle of the values of the x, y and z axes, which `values` are distances from. */
  readonly centres: readonly [number, number, number];
  /** The rows it draws, those with a value on every axis. */
  readonly placed: Placed;
  /** The name of the plot, which a screen reader reads. */
  readonly name: string;
  /** The names of the columns on the x, y and z axes. */
  readonly titles: readonly [string, string, string];
  /** The colour, size, shape and mark of every point. */
  readonly style: PointStyle;
  /** The lasso: off, armed by + or −, or drawn and waiting for Enter. */
  readonly lasso: LassoState;
}

/** A 3D scatter in its element. */
export interface Scatter3d {
  /** Draws `data`; the camera is framed on the first draw and by a double click, and stays where the user put it otherwise. */
  readonly update: (data: Scatter3dData) => void;
  /** The place of a row's point in CSS pixels of the window, or `null` when it is not drawn. */
  readonly placeOf: (row: number) => { x: number; y: number } | null;
  /** Gives the plot the keyboard's focus. */
  readonly focus: () => void;
  /** Removes it from its element and frees the GPU. */
  readonly destroy: () => void;
}

/** The camera's angle of view, top to bottom, in degrees. */
const FIELD_OF_VIEW = 30;
/** Where the camera starts, from the box's centre: the three-quarter view of the prototype. */
const HOME_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();
/** The share of the view, from its centre to each edge, the box fills when framed. */
const FILL = 0.85;
/**
 * The range of an axis with no individual placed, whose box is drawn around
 * 0 while the information bar says that none is drawn.
 */
const NO_RANGE = { min: 0, max: 0 } as const;
/** How far an arrow key turns the camera, in radians: 10°. */
const KEY_TURN = THREE.MathUtils.degToRad(10);
/** How near the camera comes to looking straight down or up, in radians, so that its up stays defined. */
const MIN_POLAR = 0.01;
/** How much of its speed the camera keeps after a drag, the prototype's damping. */
const DAMPING = 0.12;

/**
 * A 3D scatter in `element`, which it fills, with `tickText` writing the
 * value of a tick: a drag rotates, the wheel zooms, a double click frames
 * the box again; while the lasso is armed a drag draws it instead, and the
 * camera does not rotate. With the keyboard's focus on it, the arrows
 * turn it, + and − zoom, and Home frames the box again.
 */
export function createScatter3d(
  element: HTMLElement,
  events: PointViewEvents,
  tickText: (value: number) => string,
): Scatter3d {
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.01, 100);
  // The z of the data is up, as in the usual 3D plot.
  camera.up.set(0, 0, 1);
  let maps: AxisMap[] | null = null;
  let shown: { values: Scatter3dData["values"]; placed: Uint8Array; titles: string } | null = null;
  const labels = document.createElement("div");
  labels.className = "plot-labels";
  // The ticks and the titles are in the plot's name and in the table.
  labels.setAttribute("aria-hidden", "true");
  const axes = createAxesView(labels);
  // The controls are made once the base has its canvas; the base draws only
  // on a later frame, by when they are.
  const made: { controls: OrbitControls | null; onKey: (key: string) => boolean } = {
    controls: null,
    onKey: () => false,
  };
  const base = createPointView(
    element,
    camera,
    {
      beforeDraw: () => made.controls?.update() ?? false,
      afterDraw: () => {
        axes.place(base.toCanvas, camera.position);
      },
      onResize: (width, height) => {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      },
      onTheme: (token) => {
        axes.setColours(token("--color-control-border"), token("--color-border"));
      },
      onKey: (key) => made.onKey(key),
      pick: null,
    },
    labels,
    events,
  );
  base.scene.add(axes.object);
  const controls = new OrbitControls(camera, base.canvas);
  made.controls = controls;
  controls.enableDamping = true;
  controls.dampingFactor = DAMPING;
  const onChange = (): void => {
    base.cameraMoved();
  };
  controls.addEventListener("change", onChange);

  const placeCamera = (distance: number): void => {
    camera.position.copy(HOME_DIRECTION).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };

  /** Looks at the box from the home direction, as near as its eight corners allow within FILL. */
  const frame = (): void => {
    if (maps === null) {
      return;
    }
    const [x, y, z] = maps;
    if (x === undefined || y === undefined || z === undefined) {
      throw defect("a 3D scatter with fewer than three axes");
    }
    framingDistance(camera, [x.half, y.half, z.half], FILL, placeCamera);
    controls.target.set(0, 0, 0);
    controls.update();
    base.cameraMoved();
  };

  const onDoubleClick = (): void => {
    frame();
  };

  /**
   * Turns the camera around the box's centre, `azimuth` about the z axis and
   * `elevation` towards it, in radians, and moves it `factor` times as far.
   */
  const moveCamera = (azimuth: number, elevation: number, factor: number): void => {
    const offset = camera.position.clone().sub(controls.target);
    // Spherical coordinates take y as up, the camera z.
    const toYUp = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
    offset.applyQuaternion(toYUp);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += azimuth;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi - elevation,
      MIN_POLAR,
      Math.PI - MIN_POLAR,
    );
    spherical.radius *= factor;
    offset.setFromSpherical(spherical).applyQuaternion(toYUp.invert());
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    controls.update();
    base.cameraMoved();
  };

  made.onKey = (key) => {
    switch (key) {
      case "ArrowLeft":
        moveCamera(-KEY_TURN, 0, 1);
        return true;
      case "ArrowRight":
        moveCamera(KEY_TURN, 0, 1);
        return true;
      case "ArrowUp":
        moveCamera(0, KEY_TURN, 1);
        return true;
      case "ArrowDown":
        moveCamera(0, -KEY_TURN, 1);
        return true;
      case "+":
      case "=":
        moveCamera(0, 0, 1 / KEY_ZOOM);
        return true;
      case "-":
      case "−":
        moveCamera(0, 0, KEY_ZOOM);
        return true;
      case "Home":
        frame();
        return true;
      default:
        return false;
    }
  };
  base.canvas.addEventListener("dblclick", onDoubleClick);

  const setPositions = (data: Scatter3dData): void => {
    const [x, y, z] = data.values;
    const numRows = data.placed.numRows;
    if (x.length !== numRows || y.length !== numRows || z.length !== numRows) {
      throw defect(`axes of ${String(x.length)} rows in a table of ${String(numRows)}`);
    }
    // The values are added to their centres here, in 64 bits, so that values
    // far from zero and close together keep their differences.
    const ranges = data.values.map((values, axis) => {
      const range = rangeOf(values, data.placed.rows);
      const centre = at(data.centres, axis);
      return range === null ? NO_RANGE : { min: centre + range.min, max: centre + range.max };
    });
    const next = sceneMaps(ranges);
    const positions = new Float32Array(3 * numRows);
    data.values.forEach((values, axis) => {
      const map = at(next, axis);
      const centre = at(data.centres, axis);
      values.forEach((value, row) => {
        positions[3 * row + axis] = (centre + value - map.centre) * map.scale;
      });
    });
    base.setPositions(positions);
    axes.setAxes(
      data.titles.map((title, axis) => ({ title, range: at(ranges, axis) })),
      next,
      tickText,
    );
    const first = maps === null;
    maps = next;
    if (first) {
      frame();
    }
  };

  let destroyed = false;
  return {
    update: (data) => {
      const titles = data.titles.join("\u0000");
      if (
        shown === null ||
        shown.values.some((values, axis) => values !== data.values[axis]) ||
        shown.placed !== data.placed.rows ||
        shown.titles !== titles
      ) {
        setPositions(data);
        shown = { values: data.values, placed: data.placed.rows, titles };
      }
      base.setName(data.name);
      base.setStyle(data.style, data.placed.rows);
      base.setLasso(data.lasso);
      // No rotation while + or − is pressed (decided by the owner on
      // 3 October 2026); the wheel still zooms.
      controls.enableRotate = data.lasso.kind === "off";
      controls.enablePan = data.lasso.kind === "off";
    },
    placeOf: (row) => base.placeOf(row),
    focus: () => {
      base.canvas.focus();
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      base.canvas.removeEventListener("dblclick", onDoubleClick);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      axes.dispose();
      base.destroy();
    },
  };
}
