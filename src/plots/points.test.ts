import * as THREE from "three";
import { describe, expect, test } from "vitest";

import type { PointStyle } from "../state/pointStyle.ts";
import { createPoints } from "./points.ts";

/** The style of two points, each of its arrays filled with `value`. */
function styleOf(value: number): PointStyle {
  return {
    colours: new Float32Array(6).fill(value),
    sizes: new Float32Array(2).fill(value),
    shapes: new Float32Array(2).fill(value),
    marks: new Float32Array(2).fill(value),
  };
}

describe("createPoints", () => {
  test("a new style is written into the buffers it has, which the GPU is told to read again", () => {
    const points = createPoints();
    points.setPositions(new Float32Array([0, 0, 0, 1, 1, 1]));
    points.setStyle(styleOf(1));
    const { geometry } = points.object;
    const attribute = (name: string): THREE.BufferAttribute => {
      const found = geometry.getAttribute(name);
      if (!(found instanceof THREE.BufferAttribute)) {
        throw new Error(`no buffer ${name}`);
      }
      return found;
    };
    const names = ["aColour", "aSize", "aShape", "aMark"];
    const before = names.map(attribute);
    const versions = before.map((attribute) => attribute.version);
    points.setStyle(styleOf(3));
    names.forEach((name, index) => {
      const after = attribute(name);
      expect(after).toBe(before[index]);
      expect(after.version).toBeGreaterThan(versions[index] ?? Infinity);
      expect([...after.array].every((value) => value === 3)).toBe(true);
    });
    points.dispose();
  });
});
