// The map of the individuals: a point for each, placed by its latitude and
// longitude in Web Mercator, on the flat map (flatMap.ts). The points are
// drawn in an order of their own, lifted towards the camera: the hover and
// the individuals marked, selected or inside a lasso, over those of the
// groups selected, over the rest (frontend.md, "The point views").

import { at } from "../state/at.ts";
import type { ColumnNumbers } from "../state/columnNumbers.ts";
import { defect } from "../state/defect.ts";
import { hasRow } from "../state/rowSet.ts";
import type { Placed } from "../state/placed.ts";
import { MARK } from "../state/pointStyle.ts";
import type { PointStyle } from "../state/pointStyle.ts";
import { createFlatMap } from "./flatMap.ts";
import { mercatorX, mercatorY } from "./mercator.ts";
import type { LassoState, PointViewEvents } from "./pointView.ts";
import { WORLD_BOX } from "./world.ts";
import type { Box } from "./worldShapes.ts";

/** What a map of the individuals draws. */
export interface MapData {
  /** The latitudes, in degrees, one per row of the table, as distances from their centre. */
  readonly latitude: ColumnNumbers;
  /** The longitudes, in degrees, one per row of the table, as distances from their centre. */
  readonly longitude: ColumnNumbers;
  /** The rows it draws, those with a latitude and a longitude. */
  readonly placed: Placed;
  /** The name of the map, which a screen reader reads. */
  readonly name: string;
  /** The colour, size, shape and mark of every point. */
  readonly style: PointStyle;
  /** The lasso: off, armed by + or −, or drawn and waiting for Enter. */
  readonly lasso: LassoState;
}

/** A map of the individuals in its element. */
export interface MapPlot {
  /**
   * Draws `data`; the map is framed on the individuals placed when it is
   * first drawn, and by a double click, and stays where the user put it
   * otherwise.
   */
  readonly update: (data: MapData) => void;
  /** The place of a row's point in CSS pixels of the window, or `null` when it is not drawn. */
  readonly placeOf: (row: number) => { x: number; y: number } | null;
  /** The place of `latitude`, `longitude` in CSS pixels of the window. */
  readonly placeOfDegrees: (latitude: number, longitude: number) => { x: number; y: number };
  /** Gives the map the keyboard's focus. */
  readonly focus: () => void;
  /** Removes it from its element and frees the GPU. */
  readonly destroy: () => void;
}

/**
 * How far a point is lifted towards the camera for each CSS pixel of its
 * size, and for its mark, in units of the scene: the order in which the
 * points cover one another, which the camera, looking straight down, does
 * not show otherwise.
 */
const LIFT_PER_PIXEL = 0.01;
const LIFT_OF_A_MARK = 1;

/**
 * A map of the individuals in `element`, which it fills: a drag pans, the
 * wheel zooms, a double click frames the individuals again; while the
 * lasso is armed a drag draws it instead, and the map does not pan.
 */
export function createMap(element: HTMLElement, events: PointViewEvents): MapPlot {
  const map = createFlatMap(element, events, {
    onTheme: () => undefined,
    onResize: () => undefined,
    pick: null,
  });
  /** The place of each row in the scene, `x, y` for each, kept while the columns are the same. */
  let places: { from: MapData; xy: Float64Array } | null = null;
  let positions = new Float32Array(0);

  /** The places of the rows of `data`, and the box around those placed. */
  const placesOf = (data: MapData): { xy: Float64Array; box: Box } => {
    const { latitude, longitude, placed } = data;
    const numRows = placed.numRows;
    if (latitude.values.length !== numRows || longitude.values.length !== numRows) {
      throw defect(
        `a map of ${String(latitude.values.length)} latitudes and ${String(longitude.values.length)} longitudes for ${String(numRows)} rows`,
      );
    }
    const xy = new Float64Array(2 * numRows);
    let box: Box | null = null;
    for (let row = 0; row < numRows; row += 1) {
      if (!hasRow(placed.rows, row)) {
        continue;
      }
      // The values are added to their centres here, in 64 bits.
      const x = mercatorX(longitude.centre + at(longitude.values, row));
      const y = mercatorY(latitude.centre + at(latitude.values, row));
      xy[2 * row] = x;
      xy[2 * row + 1] = y;
      box =
        box === null
          ? { minX: x, minY: y, maxX: x, maxY: y }
          : {
              minX: Math.min(box.minX, x),
              minY: Math.min(box.minY, y),
              maxX: Math.max(box.maxX, x),
              maxY: Math.max(box.maxY, y),
            };
    }
    return { xy, box: box ?? WORLD_BOX };
  };

  let destroyed = false;
  return {
    update: (data) => {
      const same =
        places !== null &&
        places.from.latitude === data.latitude &&
        places.from.longitude === data.longitude &&
        places.from.placed.rows === data.placed.rows;
      if (places === null || !same) {
        const found = placesOf(data);
        places = { from: data, xy: found.xy };
        positions = new Float32Array(3 * data.placed.numRows);
        map.setHome(found.box);
      }
      const { xy } = places;
      const { sizes, marks } = data.style;
      for (let row = 0; row < data.placed.numRows; row += 1) {
        positions[3 * row] = at(xy, 2 * row);
        positions[3 * row + 1] = at(xy, 2 * row + 1);
        positions[3 * row + 2] =
          at(sizes, row) * LIFT_PER_PIXEL + (at(marks, row) === MARK.none ? 0 : LIFT_OF_A_MARK);
      }
      map.base.setPositions(positions);
      map.base.setName(data.name);
      map.base.setStyle(data.style, data.placed.rows);
      map.base.setLasso(data.lasso);
      map.setPanning(data.lasso.kind === "off");
    },
    placeOf: (row) => map.base.placeOf(row),
    placeOfDegrees: (latitude, longitude) =>
      map.toWindow(mercatorX(longitude), mercatorY(latitude)),
    focus: map.focus,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      map.destroy();
    },
  };
}
