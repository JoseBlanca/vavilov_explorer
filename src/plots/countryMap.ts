// The map of the countries: each country filled with the colour of how many
// individuals it holds, from the colour of none, and from one to the most
// in a country on a scale of blue, with a line around each country that
// holds an individual selected, on the flat map (flatMap.ts). The pointer
// picks a country, not a point.

import type { Click } from "../state/pointClick.ts";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import { at } from "../state/at.ts";
import { countColour } from "../state/countryCounts.ts";
import { rgbOf } from "../state/pointStyle.ts";
import type { Rgb } from "../state/pointStyle.ts";
import { createFlatMap } from "./flatMap.ts";
import { mercatorX, mercatorY } from "./mercator.ts";
import { WORLD_BOX, theWorld } from "./world.ts";
import { countryAt, outlineOf } from "./worldShapes.ts";
import type { CountryShape } from "./worldShapes.ts";

/** What a map of countries draws. */
export interface CountryMapData {
  /** The name of the map, which a screen reader reads. */
  readonly name: string;
  /** The individuals of each country, by the ISO numeric code of its shape; a country not in it has none. */
  readonly counts: ReadonlyMap<string, number>;
  /** The most individuals in one country. */
  readonly largest: number;
  /** The ISO numeric codes of the countries outlined, those that hold an individual selected. */
  readonly outlined: ReadonlySet<string>;
}

/**
 * What the user does over a map of countries: the pointer over a country,
 * by its place in {@link CountryMap.countries}, or over none, and a click on
 * one.
 */
export interface CountryMapEvents {
  /** The pointer moved over `country`, or none, at `place` in CSS pixels of the window; `null` and no place when it left. */
  readonly onHover: (country: number | null, place: { x: number; y: number } | null) => void;
  /** A click on `country`, which selects its individuals alone or adds them to the selection. */
  readonly onClick: (country: number, click: Exclude<Click, "range">) => void;
  /** The system changed between light and dark: the colours are read again. */
  readonly onThemeChange: () => void;
}

/** A map of countries in its element. */
export interface CountryMap {
  /** The countries it draws, which its events name by their places in this list. */
  readonly countries: readonly CountryShape[];
  /** Draws `data`; the map is framed on the world when it is first drawn, and by a double click. */
  readonly update: (data: CountryMapData) => void;
  /** The place of `latitude`, `longitude` in CSS pixels of the window. */
  readonly placeOfDegrees: (latitude: number, longitude: number) => { x: number; y: number };
  /** Gives the map the keyboard's focus. */
  readonly focus: () => void;
  /** Removes it from its element and frees the GPU. */
  readonly destroy: () => void;
}

/** The width of the line around a country with an individual selected, in CSS pixels. */
const OUTLINE_WIDTH_PX = 2;
/**
 * The width of the halo under that line, in the colour of the background,
 * so that the line shows on the darkest blue as on the palest.
 */
const HALO_WIDTH_PX = 4;

/**
 * A map of countries in `element`, which it fills: a drag pans, the wheel
 * zooms, a double click frames the world again, and a click on a country
 * goes to `events`.
 */
export function createCountryMap(element: HTMLElement, events: CountryMapEvents): CountryMap {
  const { countries } = theWorld();
  let shown: CountryMapData | null = null;
  let colours: { empty: Rgb; low: Rgb; high: Rgb } | null = null;

  // Every country's triangles in one geometry, coloured by vertex.
  const firstVertex: number[] = [];
  let vertices = 0;
  for (const country of countries) {
    firstVertex.push(vertices);
    vertices += country.triangles.length / 2;
  }
  const fillPositions = new Float32Array(3 * vertices);
  countries.forEach((country, index) => {
    const first = at(firstVertex, index);
    for (let vertex = 0; 2 * vertex < country.triangles.length; vertex += 1) {
      fillPositions[3 * (first + vertex)] = at(country.triangles, 2 * vertex);
      fillPositions[3 * (first + vertex) + 1] = at(country.triangles, 2 * vertex + 1);
    }
  });
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.BufferAttribute(fillPositions, 3));
  const fillColours = new THREE.BufferAttribute(new Float32Array(3 * vertices), 3);
  fillGeometry.setAttribute("color", fillColours);
  const fillMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false });
  const fills = new THREE.Mesh(fillGeometry, fillMaterial);
  // Under the borders, which are under everything else.
  fills.renderOrder = -2;
  fills.frustumCulled = false;

  const haloMaterial = new LineMaterial({ linewidth: HALO_WIDTH_PX, depthWrite: false });
  const lineMaterial = new LineMaterial({ linewidth: OUTLINE_WIDTH_PX, depthWrite: false });
  let outlineGeometry = new LineSegmentsGeometry();
  const halo = new LineSegments2(outlineGeometry, haloMaterial);
  const line = new LineSegments2(outlineGeometry, lineMaterial);
  halo.renderOrder = 1;
  line.renderOrder = 2;
  for (const outline of [halo, line]) {
    outline.frustumCulled = false;
    outline.visible = false;
  }

  const recolour = (): void => {
    if (shown === null || colours === null) {
      return;
    }
    const { counts, largest } = shown;
    const scale = colours;
    const linear = new THREE.Color();
    countries.forEach((country, index) => {
      // A country missing from the counts holds no individual, nor does a
      // shape with no ISO code.
      const count = country.numeric === null ? 0 : (counts.get(country.numeric) ?? 0);
      const colour = countColour(count, largest, scale);
      // Three.js takes the colours of the vertices as linear, and turns
      // them into sRGB as it draws, as the legend's CSS colours are.
      linear.setRGB(...colour, THREE.SRGBColorSpace);
      const first = at(firstVertex, index);
      for (let vertex = 0; 2 * vertex < country.triangles.length; vertex += 1) {
        fillColours.setXYZ(first + vertex, linear.r, linear.g, linear.b);
      }
    });
    fillColours.needsUpdate = true;
  };

  /**
   * Outlines the countries of `codes`, in a geometry of its own: the lines'
   * geometry makes a new buffer for each set of positions, and freeing the
   * old geometry is what frees its buffer on the GPU (frontend.md).
   */
  const outline = (codes: ReadonlySet<string>): void => {
    const segments: number[] = [];
    for (const country of countries) {
      if (country.numeric !== null && codes.has(country.numeric)) {
        const sides = outlineOf(country);
        for (let index = 0; index + 3 < sides.length; index += 4) {
          segments.push(at(sides, index), at(sides, index + 1), 0);
          segments.push(at(sides, index + 2), at(sides, index + 3), 0);
        }
      }
    }
    const old = outlineGeometry;
    outlineGeometry = new LineSegmentsGeometry();
    if (segments.length > 0) {
      outlineGeometry.setPositions(segments);
    }
    halo.geometry = outlineGeometry;
    line.geometry = outlineGeometry;
    old.dispose();
    halo.visible = segments.length > 0;
    line.visible = segments.length > 0;
  };

  const map = createFlatMap(
    element,
    {
      onHover: events.onHover,
      onClick: events.onClick,
      // The map of countries has no lasso.
      onLasso: () => undefined,
      onLassoDropped: () => undefined,
      onThemeChange: events.onThemeChange,
    },
    {
      onTheme: (token) => {
        colours = {
          empty: rgbOf(token("--color-country-empty")),
          low: rgbOf(token("--color-count-low")),
          high: rgbOf(token("--color-count-high")),
        };
        haloMaterial.color.set(token("--color-surface"));
        lineMaterial.color.set(token("--color-text"));
        recolour();
      },
      onResize: (width, height) => {
        haloMaterial.resolution.set(width, height);
        lineMaterial.resolution.set(width, height);
      },
      pick: (x, y) => countryAt(countries, x, y),
    },
  );
  map.base.scene.add(fills, halo, line);
  // No points: the base still draws its points, none of them.
  map.base.setPositions(new Float32Array(0));
  const none = new Float32Array(0);
  map.base.setStyle({ colours: none, sizes: none, shapes: none, marks: none }, new Uint8Array(0));
  map.setHome(WORLD_BOX);

  let destroyed = false;
  return {
    countries,
    update: (data) => {
      const outlinedBefore = shown?.outlined;
      shown = data;
      recolour();
      if (outlinedBefore === undefined || !sameSet(outlinedBefore, data.outlined)) {
        outline(data.outlined);
      }
      map.base.setName(data.name);
      map.base.requestDraw();
    },
    placeOfDegrees: (latitude, longitude) =>
      map.toWindow(mercatorX(longitude), mercatorY(latitude)),
    focus: map.focus,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      fillGeometry.dispose();
      fillMaterial.dispose();
      outlineGeometry.dispose();
      haloMaterial.dispose();
      lineMaterial.dispose();
      map.destroy();
    },
  };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item));
}
