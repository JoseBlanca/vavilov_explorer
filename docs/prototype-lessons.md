# Lessons from the prototype

Vavilov Explorer starts from scratch, but an earlier prototype
(`~/devel/popnei_native`, October 2026) tried the idea: a CSV of
individuals shown as a 3D scatter and a map, with groups edited by
lasso. This file keeps what it taught. Nothing here is binding; each point
is a starting position to confirm when the feature is built.

## Architecture

- **One window, several linked views.** Every view lives in one webview,
  so they share one copy of the data and one JavaScript context: linking
  is a function call, not IPC. Separate windows (for a second monitor)
  can come later as a view that mirrors the shared state over Tauri
  events, as long as no view owns the state.
- **One source of truth for the state.** The dataset, the group
  memberships, the selected group and the current selection belong
  to the controller, not to a view. Views receive positions and a
  per-point style and report user actions back.
- **A shared base for point views.** The 3D plot and the map differed only
  in camera, controls and background (axes box or country borders). A
  common base held the renderer, the points, the projection to the screen,
  picking, hover and on-demand rendering. A histogram will not be a point
  view, but should consume the same selection.
- **Per-view placement.** A row without GPS cannot be on the map but can
  be in the 3D plot. Each view needs its own "placed" mask; the shared
  style stays the same for all views.

## Rendering

- **Own renderer with Three.js, not a plotting library.** Plotly was tried
  first: it re-uploaded all traces on every edit (~300 ms for 10k points),
  drew speckles with dimmed transparent traces, and its lasso for 3D had
  to read private internals. A Three.js point cloud restyles 10k points in
  a few ms.
- **One draw call with per-point buffers** for colour, size, shape and
  highlight. Shapes are a distance field in the fragment shader (circle,
  square, diamond, cross, x); edges are antialiased with alpha-to-coverage,
  so no depth sorting is needed.
- **A thin ring in the surface colour** around each point keeps dense
  clusters readable; a highlighted point gets a wider ring in a
  contrasting colour, and must be drawn large enough for its colour to
  show inside the ring.
- **On a flat map there is no depth**, so draw order needs an explicit
  priority (lifted along z): highlighted over selected over the rest.
- **The camera framing**: fit the box's eight corners (bisection on the
  distance), not its bounding sphere, or a flat PCA box fills half the
  view.

## Map

- **Offline country borders** from Natural Earth via the `world-atlas`
  npm package (`countries-50m.json`, ~750 kB), drawn as line segments with
  `topojson-client`'s `mesh` (each shared border once). No tile server.
- **Web Mercator** with an orthographic camera looking straight down;
  OrbitControls with rotation off, left-drag to pan, `zoomToCursor`.
- **Skip segments that jump more than 180° in longitude**: Fiji and
  Chukotka cross the antimeridian and otherwise draw a line across the
  world.
- Coordinate columns were auto-detected by name (`lat`/`latitude`,
  `lon`/`long`/`lng`/`longitude`), with a dropdown to override.

## Interaction (decided with the user)

- **Editing is driven from the legend.** Clicking a group selects it:
  it grows (1.5×), the others shrink (0.4×), and ↻ / + / − appear below
  the legend, starting in ↻. Clicking it again deselects.
- **A lasso waits for Enter** (Esc cancels), as in `any_scatter3d`. The
  hint under the buttons previews what Enter will change.
- **A waiting lasso is a selection of individuals**, not a screen shape:
  it is highlighted in every view and survives rotating or panning; only
  the outline is dropped when the view moves.
- **The legend is shared by all views**, so it lives in the sidebar, not
  inside one view.

## Testing

- **End-to-end in WebKit with only IPC mocked** (`e2e/harness.mjs`) caught
  most of the real bugs: an overlay covering the legend, a sidebar overflow,
  text selected while dragging the divider.
- **Check the projection against the GPU**: for the most isolated points,
  the centre of the pixels drawn in the point's colour must be within 1 px
  of the projected position (the GPU snaps point sprites by up to half a
  pixel), and hovering there must show that individual.
- Pitfalls in such tests, all met once:
  - sample the pixel that *contains* a position with `floor`, not `round`;
  - measure a point's isolation against every visible point, not only the
    candidates away from the edges;
  - wait for the cameras to stop moving (damping keeps them coasting after
    a drag) by polling their pose, not with a fixed timeout.

## CSS pitfalls

- A `fieldset` defaults to `min-width: min-content` and overflows a narrow
  sidebar; set `min-width: 0`.
- Views where dragging means rotate, pan or lasso need
  `user-select: none`, and a draggable divider must `preventDefault` on
  pointerdown, or drags select the labels' text.
