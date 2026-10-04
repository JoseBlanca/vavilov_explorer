// The Web Mercator projection of the map, in the units of its scene: the
// world from 180° west to 180° east is x from −1 to 1, and from 85.05° south
// to 85.05° north y from −1 to 1, as web maps cut it (frontend.md, "The
// point views"; docs/prototype-lessons.md, "Map").

/**
 * The latitude, in degrees, at which Web Mercator makes the world square;
 * a place nearer a pole is drawn at it, on the map's edge.
 */
export const MAX_LATITUDE = 85.051_128_779_806_59;

/** The x of `longitude`, in degrees, in the scene. */
export function mercatorX(longitude: number): number {
  return longitude / 180;
}

/** The y of `latitude`, in degrees, in the scene, held within {@link MAX_LATITUDE}. */
export function mercatorY(latitude: number): number {
  const held = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  const radians = (held * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI;
}

/** The longitude, in degrees, of the x of the scene. */
export function longitudeOf(x: number): number {
  return x * 180;
}

/** The latitude, in degrees, of the y of the scene. */
export function latitudeOf(y: number): number {
  return (Math.atan(Math.sinh(y * Math.PI)) * 180) / Math.PI;
}
