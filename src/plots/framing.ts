// How far a camera stands from a box to frame it (frontend.md, "The camera
// framing"; docs/prototype-lessons.md).

import * as THREE from "three";

/** How many halvings the search of the distance makes, far below a pixel. */
const STEPS = 40;

/**
 * The distance from the centre of a box of half lengths `halves` at which
 * `camera` sees it as large as it can with each of its eight corners within
 * `fill` of the way from the view's centre to its edge. `place` puts the
 * camera at a distance from the centre, looking at it, and brings its
 * matrices up to date; the camera is left at the distance found.
 */
export function framingDistance(
  camera: THREE.PerspectiveCamera,
  halves: readonly [number, number, number],
  fill: number,
  place: (distance: number) => void,
): number {
  const [hx, hy, hz] = halves;
  const corners = [-1, 1].flatMap((sx) =>
    [-1, 1].flatMap((sy) => [-1, 1].map((sz) => new THREE.Vector3(sx * hx, sy * hy, sz * hz))),
  );
  const projected = new THREE.Vector3();
  const extent = (distance: number): number => {
    place(distance);
    return Math.max(
      ...corners.map((corner) => {
        projected.copy(corner).project(camera);
        return Math.max(Math.abs(projected.x), Math.abs(projected.y));
      }),
    );
  };
  const radius = Math.hypot(hx, hy, hz);
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  // The sphere around the box fits the whole view from here; the box within
  // `fill` may need the camera further, and fits nearer than the sphere.
  let far = radius / Math.sin(Math.min(vertical, horizontal) / 2);
  while (extent(far) > fill) {
    far *= 2;
  }
  let near = radius * 1.01;
  for (let step = 0; step < STEPS; step += 1) {
    const middle = (near + far) / 2;
    if (extent(middle) > fill) {
      near = middle;
    } else {
      far = middle;
    }
  }
  place(far);
  return far;
}
