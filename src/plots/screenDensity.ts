// The density of the screen a plot is drawn on, in device pixels to a CSS
// pixel, which a window moved to another screen changes (frontend.md, "The
// point views").

/** The most device pixels a CSS pixel is drawn with (frontend.md). */
const MAX_PIXEL_RATIO = 2;

/** The device pixels a CSS pixel of a plot is drawn with: the screen's, up to {@link MAX_PIXEL_RATIO}. */
export function pixelRatio(): number {
  return Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
}

/**
 * Calls `onChange` each time the window's density changes, until the
 * function it returns is called. A window moved to a screen of another
 * density keeps its size, so a ResizeObserver does not see it: a query of
 * the density does, and is asked again for the new one each time it changes.
 */
export function watchDensity(onChange: () => void): () => void {
  let density: MediaQueryList | null = null;
  const onDensityChange = (): void => {
    watch();
    onChange();
  };
  const watch = (): void => {
    density?.removeEventListener("change", onDensityChange);
    density = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    density.addEventListener("change", onDensityChange);
  };
  watch();
  return () => {
    density?.removeEventListener("change", onDensityChange);
  };
}
