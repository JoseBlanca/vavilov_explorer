// The points of a point view: one draw call for every point, with a colour,
// a size, a shape and a mark for each in buffers, and the shapes drawn as a
// distance field in the fragment shader (docs/prototype-lessons.md,
// "Rendering"; the prototype's src/scatter/points.ts).

import * as THREE from "three";

import { defect } from "../state/defect.ts";
import { MARK, SHAPES } from "../state/pointStyle.ts";
import type { PointStyle, Rgb } from "../state/pointStyle.ts";

/** The colours the shader draws with, besides each point's own. */
export interface PointColours {
  /** The surface behind the plot, of the thin ring around each point. */
  readonly ring: Rgb;
  /** The ring of an individual selected or hovered. */
  readonly marked: Rgb;
  /** The ring of an individual inside a waiting lasso drawn with +. */
  readonly lassoAdd: Rgb;
  /** The ring of an individual inside a waiting lasso drawn with −. */
  readonly lassoRemove: Rgb;
}

const VERTEX_SHADER = /* glsl */ `
  uniform float uPixelRatio;
  attribute vec3 aColour;
  attribute float aSize;
  attribute float aShape;
  attribute float aMark;
  varying vec3 vColour;
  varying float vShape;
  varying float vSizePx;
  varying float vMark;

  void main() {
    vColour = aColour;
    vShape = aShape;
    vMark = aMark;
    vSizePx = aSize * uPixelRatio;
    if (aSize <= 0.0) {
      // Outside the clip volume, so that a point not drawn is never rasterised.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = vSizePx;
  }
`;

/**
 * A point drawn smaller than this, in CSS pixels, has no ring, which
 * would leave little of its own colour: the points of the
 * groups not selected, 3.2 pixels across (chosen by the assistant on
 * 3 October 2026, with the sizes the owner is to judge).
 */
const RING_MIN_SIZE_PX = 6;

/** The codes of the shapes and the marks, as `pointStyle` writes them. */
const CODES = /* glsl */ `
  #define SHAPE_CIRCLE ${String(SHAPES.indexOf("circle"))}
  #define SHAPE_SQUARE ${String(SHAPES.indexOf("square"))}
  #define SHAPE_DIAMOND ${String(SHAPES.indexOf("diamond"))}
  #define SHAPE_CROSS ${String(SHAPES.indexOf("cross"))}
  #define MARK_NONE ${String(MARK.none)}
  #define MARK_LASSO_ADD ${String(MARK.lassoAdd)}
  #define MARK_LASSO_REMOVE ${String(MARK.lassoRemove)}
  #define RING_MIN_SIZE_PX ${RING_MIN_SIZE_PX.toFixed(1)}
`;

// The shape is a distance field, 0 at the centre and 1 at the edge, so that
// the smoothed edge and the ring are the same code for every shape; the x is
// the shape past the cross.
const FRAGMENT_SHADER = /* glsl */ `${CODES}
  uniform vec3 uRing;
  uniform vec3 uMarked;
  uniform vec3 uLassoAdd;
  uniform vec3 uLassoRemove;
  uniform float uPixelRatio;
  varying vec3 vColour;
  varying float vShape;
  varying float vSizePx;
  varying float vMark;

  float bar(vec2 a) {
    // A plus sign whose arms are 0.36 wide.
    return min(a.x, a.y) > 0.36 ? 2.0 : max(a.x, a.y);
  }

  float shapeDistance(vec2 p) {
    vec2 a = abs(p);
    int shape = int(vShape + 0.5);
    if (shape == SHAPE_CIRCLE) return length(p);
    // The square and the diamond take about the area of the circle.
    if (shape == SHAPE_SQUARE) return max(a.x, a.y) / 0.886;
    if (shape == SHAPE_DIAMOND) return (a.x + a.y) / 1.25;
    if (shape == SHAPE_CROSS) return bar(a);
    return bar(abs(vec2(p.x + p.y, p.x - p.y) * 0.7071));
  }

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = shapeDistance(p);
    float px = 2.0 / vSizePx;
    float alpha = 1.0 - smoothstep(1.0 - px, 1.0, d);
    if (alpha <= 0.0) discard;
    // A ring of one CSS pixel in the colour of the box's lines gives every
    // point an edge against the background and keeps touching points apart;
    // a marked point has a ring of two in its mark's colour.
    int mark = int(vMark + 0.5);
    bool marked = mark != MARK_NONE;
    vec3 markColour = mark == MARK_LASSO_REMOVE
      ? uLassoRemove
      : (mark == MARK_LASSO_ADD ? uLassoAdd : uMarked);
    float ringWidth = (marked ? 2.0 : 1.0) * uPixelRatio * px;
    float ring = marked || vSizePx >= RING_MIN_SIZE_PX * uPixelRatio
      ? smoothstep(1.0 - ringWidth - px, 1.0 - ringWidth, d)
      : 0.0;
    gl_FragColor = vec4(mix(vColour, marked ? markColour : uRing, ring), alpha);
  }
`;

/** The points, as a Three.js object, and the setting of their buffers. */
export interface PointsObject {
  /** The object to add to the scene. */
  readonly object: THREE.Points;
  /**
   * Sets the positions, three per point in the scene, into the buffer the
   * points have when it is of their length, as the map's order of drawing
   * changes them with every hover.
   */
  readonly setPositions: (positions: Float32Array) => void;
  /** Sets each point's colour, size, shape and mark, of as many points as the positions. */
  readonly setStyle: (style: PointStyle) => void;
  /** Sets the colours of the rings. */
  readonly setColours: (colours: PointColours) => void;
  /** Sets the device pixels of a CSS pixel. */
  readonly setPixelRatio: (ratio: number) => void;
  /** Frees the geometry and the material. */
  readonly dispose: () => void;
}

function vector(colour: Rgb): THREE.Vector3 {
  return new THREE.Vector3(...colour);
}

/** Points with no position yet. */
export function createPoints(): PointsObject {
  const geometry = new THREE.BufferGeometry();
  // The colours and the ratio are set by the base, from the theme and the
  // screen, before the first draw.
  const uniforms = {
    uPixelRatio: { value: 1 },
    uRing: { value: new THREE.Vector3() },
    uMarked: { value: new THREE.Vector3() },
    uLassoAdd: { value: new THREE.Vector3() },
    uLassoRemove: { value: new THREE.Vector3() },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    // Smoothed edges without blending, so that no point needs sorting by depth.
    alphaToCoverage: true,
  });
  const object = new THREE.Points(geometry, material);
  // Every point is inside the box, and the box is always framed.
  object.frustumCulled = false;
  let count = 0;

  // A style changes with every hover: it is written into the buffer the
  // attribute has, since a buffer replaced is freed on the GPU only when the
  // browser collects it, and the geometry's dispose frees only those it holds.
  const write = (name: string, values: Float32Array, itemSize: number): void => {
    const held = geometry.getAttribute(name);
    if (held instanceof THREE.BufferAttribute && held.array.length === values.length) {
      held.array.set(values);
      held.needsUpdate = true;
      return;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values.slice(), itemSize));
  };

  return {
    object,
    setPositions: (positions) => {
      count = positions.length / 3;
      write("position", positions, 3);
    },
    setStyle: (style) => {
      const perPoint = [style.sizes, style.shapes, style.marks];
      if (style.colours.length !== 3 * count || perPoint.some((array) => array.length !== count)) {
        throw defect(`a style of ${String(style.sizes.length)} points for ${String(count)}`);
      }
      write("aColour", style.colours, 3);
      write("aSize", style.sizes, 1);
      write("aShape", style.shapes, 1);
      write("aMark", style.marks, 1);
    },
    setColours: (colours) => {
      uniforms.uRing.value = vector(colours.ring);
      uniforms.uMarked.value = vector(colours.marked);
      uniforms.uLassoAdd.value = vector(colours.lassoAdd);
      uniforms.uLassoRemove.value = vector(colours.lassoRemove);
    },
    setPixelRatio: (ratio) => {
      uniforms.uPixelRatio.value = ratio;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
