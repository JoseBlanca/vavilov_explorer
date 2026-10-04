// The two functions of topojson-client 3.1.0 the map uses, which ships no
// types of its own. Their answers are GeoJSON, declared unknown here and
// checked where they are read (worldShapes.ts), since a declaration is a
// claim the compiler cannot check.

declare module "topojson-client" {
  /** The arcs of `object` in `topology`, each shared border once, as a GeoJSON MultiLineString. */
  export function mesh(topology: unknown, object: unknown): unknown;
  /** The geometries of `object` in `topology`, as a GeoJSON FeatureCollection. */
  export function feature(topology: unknown, object: unknown): unknown;
}
