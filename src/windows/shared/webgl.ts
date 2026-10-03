// Whether this web view can draw WebGL, which the point views draw with
// (docs/design.md, section 2.2).

/**
 * Whether the web view can make a WebGL 2 context, as Three.js does; the
 * context made to find out is given back at once, since a web view allows
 * only a few.
 */
export function canDrawWebGl(): boolean {
  const context = document.createElement("canvas").getContext("webgl2");
  if (context === null) {
    return false;
  }
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}
