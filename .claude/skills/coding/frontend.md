# The frontend: windows, views and plots

How a window is built: its copy of the backend's state, its controllers
and views in lit-html, the D3 plots and the Three.js point views. The
decisions are in `docs/design.md`, sections 2, 3, 4 and 9; what an earlier
prototype taught about the point views is in `docs/prototype-lessons.md`;
popnei_web's `/Users/jose/devel/popnei_web/.claude/skills/coding/charts.md`
is the longer source for D3 and Three.js, written for React and the web,
from which the rules below are taken.

## A window

Every window is the same page, `index.html`, which reads its window's
label and starts the controller of that kind of window, as the windowing
spike did; one page per kind of window, through Vite's multi-page build,
is the other way, and is taken if the pages grow apart. A window:

1. **Subscribes** through `src/backend/`, which gives it a snapshot at a
   revision and a channel for every change after it, and builds its copy
   of the state from the snapshot (`src/state/`).
2. **Fetches the columns it shows**, as raw bytes, by column id, and again
   when a column's revision changes.
3. **Builds its components**, each a controller in its element.
4. **Applies each message** to its copy and tells the components that
   show what changed.

A window can be reloaded at any moment, by the developer, or by WebKit
after the window was hidden, and it then runs the same steps: no state
lives only in a window but its own, which a reload may lose (`docs/design.md`,
section 3). So a window never keeps anything shared that the backend
would not give it back.

## The window's copy of the state

`src/state/` holds, for one window, the copy of the backend's state the
window needs, and the pure functions that derive what is drawn from it:
the colour and size of each point from the populations and the
selection, the counts of a histogram's bins. It is the window's one source
of truth: no controller, view or plot keeps its own copy of a part of it.

- The copy is made by `createWindowState(snapshot)`, which returns an
  object of functions: `apply(message)`, the getters, and
  `subscribe(aspect, listener)`, which returns the function that
  unsubscribes.
- **Aspects** are what changes together: `table` (the project and the
  revisions of the columns), `classification` (the active classification
  and the selected population), `codes`, `selection`, `hover` and `undo`
  (`src/state/windowState.ts`), and later the layout. A change of
  several aspects calls each listener once, after the whole message is
  applied; a message whose part does not fit leaves the copy as it was.
  A component
  subscribes to the aspects it shows, so that the hover, which can change
  sixty times a second, redraws only what shows the hover.
- `apply` ignores a message whose revision is not newer than the copy's,
  and throws a defect for one that skips a revision: the channel keeps
  the order, so a gap is a bug. The hover is the exception: it carries a
  sequence number of its own and no revision, so that hovers can be
  dropped without a gap in the revisions, by a queue in the app if one is
  ever needed (`tauri.md`), and a window keeps the hover with the highest
  number it has seen. Its header carries the current revision, which
  plays no part in the order.
- Every function of `src/state/` is pure apart from the copy itself: no
  DOM, no clock, no Tauri. So its tests are calls and literals in node.

## Controllers and views

A component is two files (`SKILL.md`): a view, a pure function from what
it shows to a lit-html template, and a controller, which holds what the
component keeps of its own, subscribes, renders, and turns the user's
actions into commands.

```ts
// populationsPanel.view.ts
export interface PopulationsPanelProps {
  readonly populations: readonly PopulationRow[];
  readonly selected: PopulationId | null;
  readonly onSelect: (population: PopulationId) => void;
}
export function populationsPanelView(props: PopulationsPanelProps): TemplateResult {
  return html`<ul class=${classOf(styles, "list")}>
    ${repeat(props.populations, (p) => p.id, (p) => html`
      <li><button aria-pressed=${p.id === props.selected} @click=${() => { props.onSelect(p.id); }}>
        ${p.name} <span>${p.count}</span>
      </button></li>`)}
  </ul>`;
}

// populationsPanel.controller.ts
export function createPopulationsPanel(element: HTMLElement, state: WindowState, backend: Backend): Component {
  const draw = (): void => {
    render(populationsPanelView({ populations: rowsOf(state), selected: state.selectedPopulation(),
      onSelect: (id) => { backend.selectPopulation(id).then(reportIfFailed, reportDefect); } }), element);
  };
  const unsubscribe = state.subscribe("classification", draw);
  draw();
  return { destroy(): void { unsubscribe(); render(nothing, element); } };
}
```

The rules of lit-html (version 3.3, `lit-html` alone, no `LitElement`):

- **`render(template, element)`** draws a template into an element, and
  drawing the same template again changes only the parts whose values
  changed. A view therefore always returns the same template literal for
  the same component, and the controller simply renders again when the
  state changes.
- **Bindings**: `${value}` for text and child templates, `attr=${v}` for
  an attribute, `?disabled=${bool}` for a boolean attribute, `.value=${v}`
  for a property, `@click=${handler}` for an event. A text binding
  escapes what it is given; `unsafeHTML` is never used (`typescript.md`).
- **A list whose items can be added, removed or reordered** is drawn with
  the `repeat` directive and a key that is the item's identity, a
  population's id and never its index, so that removing a population does
  not relabel the next one and keeps the focus on the right row.
- **A field the user types into** binds its value with the `live`
  directive, `.value=${live(v)}`, so that a render does not overwrite what
  is being typed with a stale value.
- **A control the user changes, a `<select>`'s options, a radio, a
  checkbox**, binds its state as a property with `live`,
  `.selected=${live(v)}`, never as the attribute `?selected=`: once the
  user has chosen, the attribute no longer sets what the control shows,
  and a choice the backend refused, or one changed back from another
  window, stays on screen (the review of 2 October 2026). A component
  draws again after a command that was not applied, so that such a
  control shows the state there is.
- **A view holds no state and calls nothing**: what it needs comes in as
  props, and what the user does goes out through the callbacks in props.
  A view that reads the state or calls the backend has become a
  controller.
- **A controller's `destroy`** unsubscribes and renders `nothing`, so that
  the element is left empty and no listener stays.

## Native elements first

Where HTML has the control, it is used, and it brings the keyboard and
the accessibility with it: a `<button>` for every action, never a `<div>`
with a click handler; `<select>` for the column types and the active
classification; `<dialog>` with `showModal()` for the dialogs, which takes
the focus and gives it back; `<input type="color">` for a population's
colour, which opens the system's colour picker. A control of our own is
written only where HTML has none, and it then needs its keyboard, its
role and its name, which a `<button>` would have given.

## The table

The table draws only the rows on screen (`docs/design.md`, section 2.1):

- Rows have one fixed height, so that the row at a scroll position is a
  division, and the scroll area is as tall as all the rows. The height is
  measured with `getBoundingClientRect()`, not `offsetHeight`, which is
  rounded to a whole pixel: rows of 29.75 px measured as 30 put the rows
  drawn below the viewport from row 3,600 on.
- The rows on screen and a margin around them are fetched from the
  backend a page at a time, by row index, and kept while they are near.
  An answer can come after another table loaded, or before the message of
  a change it already holds: each fetch is told apart from a later one of
  the same page, and a page is drawn only when each of its columns is at
  the revision the window's copy has (`pageStanding`).
- The table is a linked view: a selected row is drawn as selected, and a
  click or a shift-click on rows is a command that sets the selection.
- Its header holds, on every column but the first, the `<select>` of the
  column's type (`docs/design.md`, section 6). In a cell of the active
  classification the user types a population's name, with the names of
  the classification's populations suggested as they type, as the owner
  decided (`docs/design.md`, section 12); `<input list>` with a
  `<datalist>` of the names is the native element for it. What a name that
  is not yet a population does is decided with the owner when the cell is
  built.

## The D3 plots

The histograms and the bar plots, in `src/plots/`, from popnei_web's
`charts.md`:

- **A plot is a function**, `createHistogram(element, data, events)`, that
  returns a handle `{ update(data), destroy() }`. A closure, not a class.
- **Everything it draws is in its data**, labels included, and `update` is
  the only way anything changes. Callbacks, `onSelect(range)`, go in
  `events`, given once. The data are typed arrays and names, never the
  window's state: the controller turns the state into the plot's data.
- **The modules**: `d3-array` to bin, `d3-scale` and `d3-axis`,
  `d3-selection`, `d3-brush`. No `d3-transition`: an animation tells the
  user nothing a still plot does not.
- **The bars are a keyed join**, `selection.join`, keyed by the bin, and
  the selected share of each bar is a second rect inside it. A new
  selection changes only the heights of the selected shares.
- **Scales are rebuilt from the data and the size on every draw**; a scale
  kept from before is how a plot shows new data against an old axis.
- **D3 owns its plot's SVG**, and lit-html never renders inside it, so
  that no element is changed by both. Its classes start with `plot-` and
  are plain global classes of `src/plots/plots.css`, since D3 writes them
  as strings.
- **The brush** selects a range of bins; the plot calls
  `events.onSelect(range)`, and the controller turns the range into the
  individuals in it and into a command. The plot never decides a
  selection.
- **A value that cannot be drawn**, missing or not finite, is not drawn
  and not silently dropped either: the controller counts the rows the plot
  leaves out and the window shows "312 individuals without a value"
  (`docs/design.md`, section 2.2).
- **The size** comes from CSS; the plot reads it with a `ResizeObserver`,
  created in the function and disconnected in `destroy`, and draws at most
  once a frame after a resize. A plot never sets the size it observes.
- **`destroy`** leaves the element as it found it: no child, no listener,
  no observer, and it can be called twice.

## The point views

The 3D scatter and the map, in `src/plots/`, share one base, as in the
prototype (`docs/prototype-lessons.md`, "A shared base for point views"):
the renderer, the points, the projection to the screen, picking, the
hover and drawing on demand. They differ in camera, controls and
background.

- **One draw call for all the points**: one `Points` with per-point
  buffers for colour, size, shape and highlight, and the shapes drawn as a
  distance field in the fragment shader (`prototype-lessons.md`,
  "Rendering"). A change of the selection rewrites the buffers and sets
  `needsUpdate`; a hover rewrites two points with `addUpdateRange`.
- **Drawn on demand**: no animation loop. A change, a resize or a move of
  the controls requests one frame with `requestAnimationFrame`, and many
  requests in a frame make one draw.
- **Picking by projection**: each point is projected to screen pixels
  with the camera, and the nearest within a few pixels is the point
  under the pointer. Before projecting, the camera's matrices are brought
  up to date, `camera.updateMatrixWorld()` after any change of its
  position or orientation: Three.js computes them only when it renders,
  and the windowing spike projected with the identity before the first
  render and never picked a point (`spikes/windowing/README.md`). The
  projection is plain arithmetic over typed arrays, tested in node against
  literals.
- **The hover is sent at most once per frame**, and drawn only when it
  comes back from the backend, like every change. On macOS a window that
  is not active receives no pointer movement (`docs/design.md`, section
  10), so a view never relies on hover events while inactive.
- **The pixel ratio** is `Math.min(devicePixelRatio, 2)`, read again on
  every resize, since a window moved to another screen changes it; and
  `renderer.setSize(width, height, false)`, so that Three.js does not write
  the canvas's CSS size.
- **The camera framing** fits the box's eight corners, by bisection on the
  distance, not its bounding sphere (`prototype-lessons.md`).
- **The map** is Web Mercator under an orthographic camera looking down,
  with the Natural Earth borders of `world-atlas` as line segments, skipping
  segments that jump more than 180° in longitude; draw order on the flat
  map is an explicit priority lifted along z: highlighted over selected
  over the rest (`prototype-lessons.md`, "Map").
- **`destroy`** disconnects the observer, removes the listeners, disposes
  the controls, every geometry, material and texture it made (kept in a
  list as they are made), and the renderer, then calls
  `forceContextLoss()`: the browser keeps a WebGL context until it is
  collected and allows only a few at once.
- **A lost WebGL context** (`webglcontextlost`) is never silent: the view
  shows, over itself, "The 3D view was lost by the graphics card and is
  being restored.", and removes it once it has drawn again after
  `webglcontextrestored` (`docs/design.md`, section 12). A test forces a
  loss with the `WEBGL_lose_context` extension and a restore, and sees
  the message come and go.

## Keyboard

One table, in `src/windows/shared/`, lists every keyboard shortcut and
the action it starts, and each shortcut is handled exactly once:

- **Keys with no modifier**, Enter to apply a waiting lasso and Escape to
  cancel it (`prototype-lessons.md`, "Interaction"), are handled by each
  window's key module, in every window.
- **Shortcuts with a modifier**, Cmd or Ctrl with Z, S, O, belong to the
  menu, whose items carry them as accelerators. On macOS the app's menu
  bar fires them in every window. On Windows and Linux the menu is in the
  main window only (`tauri.md`), so in the other windows the key module
  handles the same entries of the table.

An action is a command of the backend, so a shortcut does the same thing
in every window, and none fires twice.

## Text and numbers on screen

- A number shown to the user is formatted with `Intl.NumberFormat` and
  the user's language; a number written for a program, a file, a key, is
  written with `String(x)`.
- A missing value is shown as missing, never as `NaN`, `undefined` or
  `null`.
- The words of a message are written from the kind and the data of an
  error, in one function beside its type, as the `writing` skill says of
  the app's text.
