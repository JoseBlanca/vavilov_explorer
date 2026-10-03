import * as THREE from "three";
import { describe, expect, test } from "vitest";

import { framingDistance } from "./framing.ts";

/** A camera of 30° looking at the origin from (1, 1, 1), and the share of the view its box fills. */
function framed(halves: [number, number, number], aspect: number): number {
  const camera = new THREE.PerspectiveCamera(30, aspect, 0.01, 100);
  camera.up.set(0, 0, 1);
  const direction = new THREE.Vector3(1, 1, 1).normalize();
  const place = (distance: number): void => {
    camera.position.copy(direction).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  framingDistance(camera, halves, 0.85, place);
  const [hx, hy, hz] = halves;
  let largest = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = new THREE.Vector3(sx * hx, sy * hy, sz * hz).project(camera);
        largest = Math.max(largest, Math.abs(corner.x), Math.abs(corner.y));
      }
    }
  }
  return largest;
}

describe("framingDistance", () => {
  test("a cube in a square view fills 0.85 of it", () => {
    expect(framed([1, 1, 1], 1)).toBeCloseTo(0.85, 6);
  });

  test("a long box, a flat one and a wide view fill 0.85 of it", () => {
    expect(framed([1, 0.25, 0.25], 1)).toBeCloseTo(0.85, 6);
    expect(framed([1, 1, 0.0001], 0.5)).toBeCloseTo(0.85, 6);
    expect(framed([1, 0.25, 0.25], 1.6)).toBeCloseTo(0.85, 6);
  });
});
