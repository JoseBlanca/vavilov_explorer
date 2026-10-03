// The axes of a 3D scatter as drawn: a box around the data with a grid on
// its floor, in the scene, and the values of the ticks and the names of the
// columns as text over the canvas, placed again after every draw
// (the prototype's src/scatter/axes_view.ts).

import * as THREE from "three";

import { at } from "../state/at.ts";
import { niceTicks } from "./axes.ts";
import type { AxisMap, AxisRange } from "./axes.ts";

/** An axis as its labels show it: the name of its column and its range. */
export interface AxisSpec {
  /** The name of the column, as in the user's file. */
  readonly title: string;
  /** The values drawn on it. */
  readonly range: AxisRange;
}

/** Projects a place of the scene to CSS pixels on the canvas, or `null` when it is behind the camera. */
export type Projector = (point: THREE.Vector3) => { x: number; y: number } | null;

/** The distance of the values of the ticks, and of the names, from their edge, in CSS pixels. */
const TICK_OFFSET_PX = 16;
const TITLE_OFFSET_PX = 40;

interface Label {
  readonly element: HTMLElement;
  readonly at: number;
}

/** The axes in the scene and their labels in `layer`. */
export interface AxesView {
  /** The box and the grid, to add to the scene. */
  readonly object: THREE.Group;
  /** Draws the axes of `specs`, mapped onto the scene by `maps`, with `tickText` writing a value. */
  readonly setAxes: (
    specs: readonly AxisSpec[],
    maps: readonly AxisMap[],
    tickText: (value: number) => string,
  ) => void;
  /** Sets the colours of the box and of the grid, as CSS writes them. */
  readonly setColours: (box: string, grid: string) => void;
  /** Places the labels for the camera at `camera`; called after every draw. */
  readonly place: (project: Projector, camera: THREE.Vector3) => void;
  /** Frees the geometries and the materials, and empties the layer. */
  readonly dispose: () => void;
}

/** Axes with none drawn yet, their labels in `layer`. */
export function createAxesView(layer: HTMLElement): AxesView {
  const object = new THREE.Group();
  // The box and the grid are drawn first and leave no depth, so that a
  // point on an edge of the box, as the largest value of two axes is, is
  // drawn over the edge and not under it. Neither is transparent: Three.js
  // draws what is transparent after the rest, over the points.
  object.renderOrder = -1;
  const boxMaterial = new THREE.LineBasicMaterial({ depthWrite: false });
  const gridMaterial = new THREE.LineBasicMaterial({ depthWrite: false });
  let half: readonly [number, number, number] = [1, 1, 1];
  let labels: { ticks: Label[]; title: Label }[] = [];
  /** The geometries made for the axes shown, freed when they change. */
  let geometries: THREE.BufferGeometry[] = [];

  const label = (text: string, kind: "tick" | "title", at: number): Label => {
    const element = document.createElement("span");
    element.className = kind === "tick" ? "plot-tick" : "plot-axis-title";
    element.textContent = text;
    layer.append(element);
    return { element, at };
  };

  const clear = (): void => {
    for (const geometry of geometries) {
      geometry.dispose();
    }
    geometries = [];
    object.clear();
    layer.replaceChildren();
  };

  /** Puts `element` at `point`, pushed `offset` pixels away from the box's centre. */
  const put = (
    element: HTMLElement,
    point: { x: number; y: number } | null,
    centre: { x: number; y: number },
    offset: number,
  ): void => {
    element.toggleAttribute("hidden", point === null);
    if (point === null) {
      return;
    }
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const distance = Math.hypot(dx, dy);
    const length = distance > 0 ? distance : 1;
    const x = point.x + (dx / length) * offset;
    const y = point.y + (dy / length) * offset;
    element.style.setProperty(
      "transform",
      `translate(${String(x)}px, ${String(y)}px) translate(-50%, -50%)`,
    );
  };

  return {
    object,
    setAxes: (specs, maps, tickText) => {
      clear();
      half = [at(maps, 0).half, at(maps, 1).half, at(maps, 2).half];
      const [hx, hy, hz] = half;
      labels = specs.map((spec, axis) => {
        const map = at(maps, axis);
        const ticks = niceTicks(spec.range.min, spec.range.max).map((value) =>
          label(tickText(value), "tick", (value - map.centre) * map.scale),
        );
        return { ticks, title: label(spec.title, "title", 0) };
      });
      const solid = new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz);
      const box = new THREE.EdgesGeometry(solid);
      solid.dispose();
      geometries.push(box);
      object.add(new THREE.LineSegments(box, boxMaterial));
      const grid: number[] = [];
      for (const tick of labels[0]?.ticks ?? []) {
        grid.push(tick.at, -hy, -hz, tick.at, hy, -hz);
      }
      for (const tick of labels[1]?.ticks ?? []) {
        grid.push(-hx, tick.at, -hz, hx, tick.at, -hz);
      }
      const gridGeometry = new THREE.BufferGeometry();
      gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
      geometries.push(gridGeometry);
      object.add(new THREE.LineSegments(gridGeometry, gridMaterial));
    },
    setColours: (box, grid) => {
      boxMaterial.color.set(box);
      gridMaterial.color.set(grid);
    },
    place: (project, camera) => {
      if (labels.length === 0) {
        return;
      }
      const [hx, hy, hz] = half;
      const centre = project(new THREE.Vector3(0, 0, 0));
      if (centre === null) {
        return;
      }
      // The values of x and y go on the edge of the floor nearer the
      // camera, those of z on the upright edge furthest left on the screen.
      const yEdge = camera.y >= 0 ? hy : -hy;
      const xEdge = camera.x >= 0 ? hx : -hx;
      let left = { x: -hx, y: -hy, screenX: Infinity };
      for (const [x, y] of [
        [-hx, -hy],
        [hx, -hy],
        [hx, hy],
        [-hx, hy],
      ] as const) {
        const screen = project(new THREE.Vector3(x, y, -hz));
        if (screen !== null && screen.x < left.screenX) {
          left = { x, y, screenX: screen.x };
        }
      }
      const along = [
        (at: number) => new THREE.Vector3(at, yEdge, -hz),
        (at: number) => new THREE.Vector3(xEdge, at, -hz),
        (at: number) => new THREE.Vector3(left.x, left.y, at),
      ];
      labels.forEach((axis, index) => {
        const placeAt = along[index];
        if (placeAt === undefined) {
          return;
        }
        for (const tick of axis.ticks) {
          put(tick.element, project(placeAt(tick.at)), centre, TICK_OFFSET_PX);
        }
        put(axis.title.element, project(placeAt(0)), centre, TITLE_OFFSET_PX);
      });
    },
    dispose: () => {
      clear();
      boxMaterial.dispose();
      gridMaterial.dispose();
      labels = [];
    },
  };
}
