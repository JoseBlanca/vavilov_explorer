// The 2D scatter: the individuals as points on two columns, drawn in SVG,
// with an axis at the bottom and one at the left, ticks at round values and
// a light grid behind the points (docs/design.md, section 2.2). It pans and
// zooms as the maps do, by its own arithmetic (view2d.ts), and shares with
// the point views the pointer's hover, clicks and lasso (pointerInput.ts).
// It draws what it is given and reports what the user does; it knows
// nothing of the backend or of a window.

import { scaleLinear } from "d3-scale";

import { at } from "../state/at.ts";
import type { ColumnNumbers } from "../state/columnNumbers.ts";
import { defect } from "../state/defect.ts";
import type { Placed } from "../state/placed.ts";
import { POINT_SIZE_PX, SELECTED_GROUP_SCALE } from "../state/pointStyle.ts";
import type { PointStyle } from "../state/pointStyle.ts";
import { hasRow } from "../state/rowSet.ts";
import { rangeOf } from "./axes.ts";
import { createPointerInput } from "./pointerInput.ts";
import type { LassoState, PointViewEvents } from "./pointerInput.ts";
import { shapePath } from "./pointShapes.ts";
import { pickPoint } from "./projection.ts";
import type { ScreenPoints } from "./projection.ts";
import { homeView, panView, zoomView } from "./view2d.ts";
import type { View2d } from "./view2d.ts";
import "./plots.css";

const SVG = "http://www.w3.org/2000/svg";

/** The room around the points for the axes, in CSS pixels, as the histogram's. */
const MARGIN = { top: 18, right: 20, bottom: 52, left: 72 } as const;
/** The length of a tick of an axis, in CSS pixels. */
const TICK_PX = 5;
/** About one tick of the x axis for this many CSS pixels, and of the y axis for the next. */
const X_TICK_SPACING_PX = 90;
const Y_TICK_SPACING_PX = 50;
/** The pointer reaches a point this many CSS pixels beyond its edge, as in the point views. */
const PICK_SLOP_PX = 3;
/** How far an arrow key moves the view, as a share of it, as on the maps. */
const KEY_PAN = 0.1;
/** How many times nearer + brings the view, and − takes it further, as on the maps. */
const KEY_ZOOM = 1.25;
/** How much one pixel of the wheel's movement zooms, as a power of e. */
const WHEEL_ZOOM_PER_PX = 0.002;
/** The pixels of a line of the wheel, in a browser that scrolls by lines. */
const WHEEL_LINE_PX = 16;
/**
 * The size above which a point is the hover, drawn over every other: a
 * point marked is drawn at least as large as a selected group's
 * (pointStyle.ts), and the hover larger still.
 */
const HOVER_SIZE_ABOVE = POINT_SIZE_PX * SELECTED_GROUP_SCALE;

/** What the 2D scatter draws. */
export interface Scatter2dData {
  /** The values of the x and the y column. */
  readonly x: ColumnNumbers;
  readonly y: ColumnNumbers;
  /** The names of the two columns, under the x axis and beside the y axis. */
  readonly titles: readonly [string, string];
  /** The rows it draws, those with a value on both axes. */
  readonly placed: Placed;
  /** The name of the plot, which a screen reader reads. */
  readonly name: string;
  /** The colour, size, shape and mark of every point. */
  readonly style: PointStyle;
  /** The lasso: off, armed by + or −, or drawn and waiting for Enter. */
  readonly lasso: LassoState;
}

/** The 2D scatter, for its controller. */
export interface Scatter2d {
  /** Draws `data`. */
  readonly update: (data: Scatter2dData) => void;
  /** The place of a row's point in CSS pixels of the window, or `null` when it is not drawn. */
  readonly placeOf: (row: number) => { x: number; y: number } | null;
  /** Gives the plot the keyboard's focus. */
  readonly focus: () => void;
  /** Leaves the element as it found it. */
  readonly destroy: () => void;
}

/** Which layer a point is drawn in: under the others, marked, or the hover over all. */
type Layer = 0 | 1 | 2;

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  className: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  element.setAttribute("class", className);
  return element;
}

/** A colour of the style, three values from 0 to 1, as CSS writes it. */
function rgbText(colours: Float32Array, row: number): string {
  const channel = (index: number): number => Math.round(at(colours, 3 * row + index) * 255);
  return `rgb(${String(channel(0))}, ${String(channel(1))}, ${String(channel(2))})`;
}

/**
 * A 2D scatter in `element`, which it fills, with `tickText` writing the
 * value of a tick: a drag pans, the wheel zooms where the pointer is, a
 * double click frames every point again; while the lasso is armed a drag
 * draws it instead, and does not pan. With the keyboard's focus on it, the
 * arrows pan, + and − zoom, and Home frames every point again.
 */
export function createScatter2d(
  element: HTMLElement,
  events: PointViewEvents,
  tickText: (value: number) => string,
): Scatter2d {
  const frame = document.createElement("div");
  frame.className = "plot-frame";
  const svg = svgElement("svg", "plot-canvas plot-scatter2d");
  // One control to the keyboard and to a screen reader, named by the
  // controller, as the point views' canvas; its data is reachable in the
  // main window's table.
  svg.setAttribute("role", "application");
  svg.setAttribute("tabindex", "0");
  const clipId = `plot-scatter2d-clip-${String(Math.random()).slice(2)}`;
  const defs = svgElement("defs", "plot-scatter2d-defs");
  const clip = svgElement("clipPath", "plot-scatter2d-clip");
  clip.setAttribute("id", clipId);
  const clipBox = svgElement("rect", "plot-scatter2d-clip-box");
  clip.append(clipBox);
  defs.append(clip);
  const grid = svgElement("g", "plot-scatter2d-grid");
  const axes = svgElement("g", "plot-scatter2d-axes");
  const pointsGroup = svgElement("g", "plot-scatter2d-points");
  pointsGroup.setAttribute("clip-path", `url(#${clipId})`);
  const layers = [
    svgElement("g", "plot-scatter2d-layer"),
    svgElement("g", "plot-scatter2d-layer"),
    svgElement("g", "plot-scatter2d-layer"),
  ] as const;
  // Moved as one by a pan, inside the clip, which stays.
  const shift = svgElement("g", "plot-scatter2d-shift");
  shift.append(...layers);
  pointsGroup.append(shift);
  svg.append(defs, grid, axes, pointsGroup);
  frame.append(svg);
  element.append(frame);

  let width = 0;
  let height = 0;
  let data: Scatter2dData | null = null;
  /** The data the points' elements were made for: their values and the rows placed. */
  let madeFor: { x: Float32Array; y: Float32Array; placed: Uint8Array } | null = null;
  let elements: (SVGPathElement | null)[] = [];
  /** The style the elements show, or `null` for new elements, so that a new style touches only the points it changes. */
  let styled: PointStyle | null = null;
  /** The layer of each point, by row. */
  let layerOf = new Uint8Array(0);
  /** The view and the size the points were placed for, which a pan moves as one. */
  let placedFor: { view: View2d; width: number; height: number } | null = null;
  let home: View2d | null = null;
  let view: View2d | null = null;
  let screen: ScreenPoints | null = null;
  let frameRequest = 0;
  let pan: { x: number; y: number } | null = null;

  const plotWidth = (): number => Math.max(width - MARGIN.left - MARGIN.right, 1);
  const plotHeight = (): number => Math.max(height - MARGIN.top - MARGIN.bottom, 1);

  /** Each point's place on the frame; NaN for one not drawn or outside the axes. */
  const project = (): ScreenPoints => {
    if (screen !== null) {
      return screen;
    }
    const count = data?.placed.numRows ?? 0;
    const xy = new Float32Array(2 * count).fill(Number.NaN);
    // Smaller nearer: the hover over the marked over the rest, as drawn.
    const depth = new Float32Array(count).fill(Infinity);
    if (data !== null && view !== null) {
      const { x, y, placed } = data;
      const right = MARGIN.left + plotWidth();
      const bottom = MARGIN.top + plotHeight();
      const xScale = scaleLinear()
        .domain([view.left - x.centre, view.right - x.centre])
        .range([MARGIN.left, right]);
      const yScale = scaleLinear()
        .domain([view.bottom - y.centre, view.top - y.centre])
        .range([bottom, MARGIN.top]);
      for (let row = 0; row < count; row += 1) {
        if (!hasRow(placed.rows, row)) {
          continue;
        }
        const px = xScale(at(x.values, row));
        const py = yScale(at(y.values, row));
        if (px < MARGIN.left || px > right || py < MARGIN.top || py > bottom) {
          continue;
        }
        xy[2 * row] = px;
        xy[2 * row + 1] = py;
        depth[row] = 2 - at(layerOf, row);
      }
    }
    screen = { xy, depth };
    return screen;
  };

  const sizes = (): Float32Array => data?.style.sizes ?? new Float32Array(0);

  const pick = (px: number, py: number): number | null =>
    pickPoint(project(), sizes(), px, py, PICK_SLOP_PX);

  const input = createPointerInput(frame, { pick, screen: project }, events);

  /** Makes an element for each row placed, as the values or the rows placed change. */
  const makePoints = (given: Scatter2dData): void => {
    for (const layer of layers) {
      layer.replaceChildren();
    }
    const count = given.placed.numRows;
    elements = Array.from({ length: count }, (_, row) => {
      if (!hasRow(given.placed.rows, row)) {
        return null;
      }
      const point = svgElement("path", "plot-scatter2d-point");
      layers[0].append(point);
      return point;
    });
    styled = null;
    layerOf = new Uint8Array(count);
    placedFor = null;
    madeFor = { x: given.x.values, y: given.y.values, placed: given.placed.rows };
  };

  /** Gives each point its style, touching only the points whose style changed. */
  const stylePoints = (style: PointStyle): void => {
    const before = styled;
    elements.forEach((point, row) => {
      if (point === null) {
        return;
      }
      const same = (values: (given: PointStyle) => Float32Array, index: number): boolean =>
        before !== null && values(before)[index] === values(style)[index];
      const colour = (given: PointStyle): Float32Array => given.colours;
      if (!(same(colour, 3 * row) && same(colour, 3 * row + 1) && same(colour, 3 * row + 2))) {
        point.setAttribute("fill", rgbText(style.colours, row));
      }
      const size = at(style.sizes, row);
      const mark = at(style.marks, row);
      if (!same((given) => given.shapes, row) || !same((given) => given.sizes, row)) {
        point.setAttribute("d", shapePath(at(style.shapes, row), size));
      }
      if (!same((given) => given.marks, row)) {
        point.setAttribute("data-mark", String(mark));
      }
      const layer: Layer = size > HOVER_SIZE_ABOVE ? 2 : mark === 0 ? 0 : 1;
      if (before === null || layerOf[row] !== layer) {
        layers[layer].append(point);
        layerOf[row] = layer;
      }
    });
    styled = style;
    screen = null;
  };

  /**
   * Places every point for the view, the size and the values there are. A
   * point outside the axes is placed too, and hidden by the clip, so that a
   * pan, which moves every point as one, brings it in.
   */
  const placePoints = (): void => {
    if (data === null || view === null) {
      return;
    }
    const { x, y } = data;
    const xScale = scaleLinear()
      .domain([view.left - x.centre, view.right - x.centre])
      .range([MARGIN.left, MARGIN.left + plotWidth()]);
    const yScale = scaleLinear()
      .domain([view.bottom - y.centre, view.top - y.centre])
      .range([MARGIN.top + plotHeight(), MARGIN.top]);
    elements.forEach((point, row) => {
      if (point === null) {
        return;
      }
      const px = xScale(at(x.values, row));
      const py = yScale(at(y.values, row));
      point.setAttribute("transform", `translate(${px.toFixed(2)},${py.toFixed(2)})`);
    });
    shift.removeAttribute("transform");
    placedFor = { view, width, height };
  };

  /**
   * Moves the points placed for another view by the pan between the two,
   * when the view has the same spans at the same size; places them again
   * otherwise.
   */
  const followView = (): void => {
    if (view === null) {
      return;
    }
    const before = placedFor;
    const sameSpan = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.abs(b);
    if (
      before?.width !== width ||
      before.height !== height ||
      !sameSpan(view.right - view.left, before.view.right - before.view.left) ||
      !sameSpan(view.top - view.bottom, before.view.top - before.view.bottom)
    ) {
      placePoints();
      return;
    }
    const dx = ((before.view.left - view.left) / (view.right - view.left)) * plotWidth();
    const dy = ((view.bottom - before.view.bottom) / (view.top - view.bottom)) * plotHeight();
    shift.setAttribute("transform", `translate(${dx.toFixed(2)},${dy.toFixed(2)})`);
  };

  /** Draws the grid and the axes of `view`, with the names of the columns. */
  const drawAxes = (given: Scatter2dData, now: View2d): void => {
    grid.replaceChildren();
    axes.replaceChildren();
    const left = MARGIN.left;
    const right = MARGIN.left + plotWidth();
    const top = MARGIN.top;
    const bottom = MARGIN.top + plotHeight();
    clipBox.setAttribute("x", String(left));
    clipBox.setAttribute("y", String(top));
    clipBox.setAttribute("width", String(right - left));
    clipBox.setAttribute("height", String(bottom - top));
    const x = scaleLinear().domain([now.left, now.right]).range([left, right]);
    const y = scaleLinear().domain([now.bottom, now.top]).range([bottom, top]);
    const line = (x1: number, y1: number, x2: number, y2: number, into: SVGGElement): void => {
      const drawn = svgElement("line", "plot-scatter2d-line");
      drawn.setAttribute("x1", String(x1));
      drawn.setAttribute("y1", String(y1));
      drawn.setAttribute("x2", String(x2));
      drawn.setAttribute("y2", String(y2));
      into.append(drawn);
    };
    const text = (
      words: string,
      place: { x: number; y: number },
      anchor: string,
      className: string,
    ): SVGTextElement => {
      const drawn = svgElement("text", className);
      drawn.setAttribute("x", String(place.x));
      drawn.setAttribute("y", String(place.y));
      drawn.setAttribute("text-anchor", anchor);
      drawn.textContent = words;
      axes.append(drawn);
      return drawn;
    };
    for (const value of x.ticks(Math.max(Math.floor((right - left) / X_TICK_SPACING_PX), 2))) {
      const px = x(value);
      line(px, top, px, bottom, grid);
      line(px, bottom, px, bottom + TICK_PX, axes);
      text(tickText(value), { x: px, y: bottom + TICK_PX + 14 }, "middle", "plot-scatter2d-tick");
    }
    for (const value of y.ticks(Math.max(Math.floor((bottom - top) / Y_TICK_SPACING_PX), 2))) {
      const py = y(value);
      line(left, py, right, py, grid);
      line(left - TICK_PX, py, left, py, axes);
      text(tickText(value), { x: left - TICK_PX - 4, y: py + 4 }, "end", "plot-scatter2d-tick");
    }
    line(left, bottom, right, bottom, axes);
    line(left, top, left, bottom, axes);
    const [xTitle, yTitle] = given.titles;
    text(xTitle, { x: (left + right) / 2, y: height - 10 }, "middle", "plot-scatter2d-title");
    const turned = text(yTitle, { x: 0, y: 0 }, "middle", "plot-scatter2d-title");
    turned.setAttribute("transform", `translate(16,${String((top + bottom) / 2)}) rotate(-90)`);
  };

  const draw = (): void => {
    frameRequest = 0;
    if (data === null || view === null || width === 0 || height === 0) {
      return;
    }
    screen = null;
    drawAxes(data, view);
    followView();
    input.drawn();
  };

  const requestDraw = (): void => {
    if (frameRequest === 0) {
      frameRequest = requestAnimationFrame(draw);
    }
  };

  /** The view moved: what was drawn on it, the lasso and the hover, follows. */
  const moveTo = (next: View2d): void => {
    view = next;
    screen = null;
    input.viewMoved();
    requestDraw();
  };

  const frameHome = (): void => {
    if (home !== null) {
      moveTo(home);
    }
  };

  /** The share of the plot's width and height from its left and its bottom of `px`, `py` on the frame. */
  const shareOf = (px: number, py: number): { fx: number; fy: number } => ({
    fx: Math.min(Math.max((px - MARGIN.left) / plotWidth(), 0), 1),
    fy: Math.min(Math.max((MARGIN.top + plotHeight() - py) / plotHeight(), 0), 1),
  });

  const zoomAt = (factor: number, fx: number, fy: number): void => {
    if (view !== null && home !== null) {
      moveTo(zoomView(view, factor, fx, fy, home));
    }
  };

  const local = (event: MouseEvent): { x: number; y: number } => {
    const rect = frame.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    // A drag that leaves the frame still pans, or still draws its lasso.
    frame.setPointerCapture(event.pointerId);
    if (data?.lasso.kind === "off") {
      pan = local(event);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pan === null || view === null || event.buttons === 0) {
      return;
    }
    const place = local(event);
    const dx = (pan.x - place.x) / plotWidth();
    const dy = (place.y - pan.y) / plotHeight();
    pan = place;
    moveTo(panView(view, dx, dy));
  };

  const onPointerUp = (event: PointerEvent): void => {
    pan = null;
    if (frame.hasPointerCapture(event.pointerId)) {
      frame.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1;
    const { fx, fy } = shareOf(local(event).x, local(event).y);
    zoomAt(Math.exp(-event.deltaY * pixels * WHEEL_ZOOM_PER_PX), fx, fy);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) {
      return;
    }
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        if (view !== null) moveTo(panView(view, -KEY_PAN, 0));
        break;
      case "ArrowRight":
        if (view !== null) moveTo(panView(view, KEY_PAN, 0));
        break;
      case "ArrowUp":
        if (view !== null) moveTo(panView(view, 0, KEY_PAN));
        break;
      case "ArrowDown":
        if (view !== null) moveTo(panView(view, 0, -KEY_PAN));
        break;
      case "+":
      case "=":
        zoomAt(KEY_ZOOM, 0.5, 0.5);
        break;
      case "-":
      case "−":
        zoomAt(1 / KEY_ZOOM, 0.5, 0.5);
        break;
      case "Home":
        frameHome();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
    }
  };

  const readTheme = (): void => {
    const style = getComputedStyle(element);
    const token = (name: string): string => {
      const value = style.getPropertyValue(name).trim();
      if (value === "") {
        throw defect(`no token ${name} for a 2D scatter`);
      }
      return value;
    };
    input.setColours(token("--color-add-surface"), token("--color-remove-surface"));
  };

  const onSchemeChange = (): void => {
    readTheme();
    events.onThemeChange();
  };

  const resize = (): void => {
    const rect = frame.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    input.resize(width, height, window.devicePixelRatio);
    screen = null;
    requestDraw();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(frame);
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", onSchemeChange);
  frame.addEventListener("pointerdown", onPointerDown);
  frame.addEventListener("pointermove", onPointerMove);
  frame.addEventListener("pointerup", onPointerUp);
  frame.addEventListener("pointercancel", onPointerUp);
  frame.addEventListener("wheel", onWheel, { passive: false });
  frame.addEventListener("dblclick", frameHome);
  svg.addEventListener("keydown", onKeyDown);
  readTheme();

  let destroyed = false;
  return {
    update: (given) => {
      const remake = !(
        madeFor?.x === given.x.values &&
        madeFor.y === given.y.values &&
        madeFor.placed === given.placed.rows
      );
      data = given;
      if (remake) {
        makePoints(given);
        const xRange = rangeOf(given.x.values, given.placed.rows) ?? { min: 0, max: 0 };
        const yRange = rangeOf(given.y.values, given.placed.rows) ?? { min: 0, max: 0 };
        home = homeView(
          { min: given.x.centre + xRange.min, max: given.x.centre + xRange.max },
          { min: given.y.centre + yRange.min, max: given.y.centre + yRange.max },
        );
        // Framed the first time; a change of the values keeps the view.
        view ??= home;
      }
      stylePoints(given.style);
      svg.setAttribute("aria-label", given.name);
      input.setLasso(given.lasso);
      if (given.lasso.kind !== "off") {
        pan = null;
      }
      requestDraw();
    },
    placeOf: (row) => {
      const place = project();
      const x = place.xy[2 * row];
      const y = place.xy[2 * row + 1];
      if (x === undefined || y === undefined || Number.isNaN(x)) {
        return null;
      }
      const rect = frame.getBoundingClientRect();
      return { x: rect.left + x, y: rect.top + y };
    },
    focus: () => {
      svg.focus();
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      cancelAnimationFrame(frameRequest);
      observer.disconnect();
      scheme.removeEventListener("change", onSchemeChange);
      frame.removeEventListener("pointerdown", onPointerDown);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerup", onPointerUp);
      frame.removeEventListener("pointercancel", onPointerUp);
      frame.removeEventListener("wheel", onWheel);
      frame.removeEventListener("dblclick", frameHome);
      svg.removeEventListener("keydown", onKeyDown);
      input.destroy();
      frame.remove();
    },
  };
}
