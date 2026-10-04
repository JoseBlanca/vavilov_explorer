// The world the maps draw: the borders and countries of Natural Earth at
// 1:50 million, from world-atlas (docs/prototype-lessons.md, "Map"), read
// once per window, when its first map is made, and the part of it a map of
// the whole world frames.

import atlas from "world-atlas/countries-50m.json?raw";

import { mercatorY } from "./mercator.ts";
import { worldShapes } from "./worldShapes.ts";
import type { Box, WorldShapes } from "./worldShapes.ts";

let read: WorldShapes | null = null;

/** The borders and countries of the world, read on the first call. */
export function theWorld(): WorldShapes {
  if (read === null) {
    const topology: unknown = JSON.parse(atlas);
    read = worldShapes(topology);
  }
  return read;
}

/**
 * The part of the world a map of all of it frames: every longitude, and
 * from 58° south, below Cape Horn, to 84° north, above Greenland, which
 * leaves out Antarctica, which Web Mercator draws larger than every other
 * continent.
 */
export const WORLD_BOX: Box = {
  minX: -1,
  minY: mercatorY(-58),
  maxX: 1,
  maxY: mercatorY(84),
};
