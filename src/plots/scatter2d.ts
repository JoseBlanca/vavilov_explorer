// The 2D scatter: the individuals as points on two columns, drawn in SVG,
// with an axis at the bottom and one at the left, ticks at round values and
// a light grid behind the points (docs/design.md, section 2.2). It pans and
// zooms as the maps do, by its own arithmetic (view2d.ts), and shares with
// the point views the pointer's hover, clicks and lasso (pointerInput.ts).
// It draws what it is given and reports what the user does; it knows
// nothing of the backend or of a window.

import { scaleLinear } from "d3-scale";
import type { ScaleLinear } from "d3-scale";

import { at } from "../state/at.ts";
import type { ColumnNumbers } from "../state/columnNumbers.ts";
import { defect } from "../state/defect.ts";
import type { Placed } from "../state/placed.ts";
import type { PointStyle } from "../state/pointStyle.ts";
import { hasRow } from "../state/rowSet.ts";
import { rangeOf } from "./axes.ts";
import { createPointerInput, placeOnFrame } from "./pointerInput.ts";
import type { LassoState, PointViewEvents } from "./pointerInput.ts";
import { pointLayer } from "./pointLayer.ts";
import { shapePath } from "./pointShapes.ts";
import { PICK_SLOP_PX, pickPoint } from "./projection.ts";
import type { ScreenPoints } from "./projection.ts";
import { pixelRatio, watchDensity } from "./screenDensity.ts";
import { homeView, panView, wheelPixels, wheelZoom, zoomView } from "./view2d.ts";
import type { View2d } from "./view2d.ts";
import { KEY_PAN, KEY_ZOOM } from "./viewKeys.ts";
import "./plots.css";
import { AXES_MARGIN as MARGIN, TICK_PX, svgElement } from "./svg.ts";

/** How far below its tick the baseline of an x tick's value is, in CSS pixels. */
const X_TICK_TEXT_DROP_PX = 14;
/** The gap between a y tick and its value, in CSS pixels. */
const Y_TICK_TEXT_GAP_PX = 4;
/** How far below its tick the baseline of a y tick's value is, so that the digits sit on it. */
const Y_TICK_TEXT_RAISE_PX = 4;
/** How far above the bottom of the frame the baseline of the x axis's name is, in CSS pixels. */
const X_TITLE_RAISE_PX = 10;
/** How far from the left of the frame the y axis's name, turned, is centred, in CSS pixels. */
const Y_TITLE_INSET_PX = 16;
/**
 * Two spans of a view this close, as a share of them, are the same span:
 * a pan moves the view, which adds and takes away the same amount at each
 * edge, and changes only the last bits of a span.
 */
const SAME_SPAN_SHARE = 1e-9;
/** About one tick of the x axis for this many CSS pixels, and of the y axis for the next. */
const X_TICK_SPACING_PX = 90;
const Y_TICK_SPACING_PX = 50;

/**
 * The range of an axis with no individual placed, whose axes are drawn
 * around its centre while the count says that none is drawn, as in the 3D
 * scatter.
 */
const NO_RANGE = { min: 0, max: 0 } as const;

/** What the 2D scatter draws. */
export interface Scatter2dData {
  /** The values of the x column, along the bottom. */
  readonly x: ColumnNumbers;
  /** The values of the y column, up the left. */
  readonly y: ColumnNumbers;
  /** The names of the two columns, under the x axis and beside the y axis. */
  readonly titles: readonly [string, string];
  /** The rows it draws, those with a value on both axes. */
  readonly placed: Placed;
  /** The name of the plot, which a screen reader reads. */
  readonly name: string;
  /** The colour, size, shape and mark of every point. */
  readonly style: PointStyle;
  /** The row under the pointer, drawn over every other, or `null`. */
  readonly hover: number | null;
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
  const svg = svgElement("svg", { class: "plot-canvas plot-scatter2d" });
  // One control to the keyboard and to a screen reader, named by the
  // controller, as the point views' canvas; its data is reachable in the
  // main window's table.
  svg.setAttribute("role", "application");
  svg.setAttribute("tabindex", "0");
  const clipId = `plot-scatter2d-clip-${String(Math.random()).slice(2)}`;
  const defs = svgElement("defs", { class: "plot-scatter2d-defs" });
  const clip = svgElement("clipPath", { class: "plot-scatter2d-clip" });
  clip.setAttribute("id", clipId);
  const clipBox = svgElement("rect", { class: "plot-scatter2d-clip-box" });
  clip.append(clipBox);
  defs.append(clip);
  const grid = svgElement("g", { class: "plot-scatter2d-grid" });
  const axes = svgElement("g", { class: "plot-scatter2d-axes" });
  const pointsGroup = svgElement("g", { class: "plot-scatter2d-points" });
  pointsGroup.setAttribute("clip-path", `url(#${clipId})`);
  const layers = [
    svgElement("g", { class: "plot-scatter2d-layer" }),
    svgElement("g", { class: "plot-scatter2d-layer" }),
    svgElement("g", { class: "plot-scatter2d-layer" }),
  ] as const;
  // Moved as one by a pan, inside the clip, which stays.
  const shift = svgElement("g", { class: "plot-scatter2d-shift" });
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
  /** Whether the view was framed on values, and not on {@link NO_RANGE}. */
  let framedOnValues = false;
  let screen: ScreenPoints | null = null;
  let frameRequest = 0;
  let pan: { x: number; y: number } | null = null;

  const plotWidth = (): number => Math.max(width - MARGIN.left - MARGIN.right, 1);
  const plotHeight = (): number => Math.max(height - MARGIN.top - MARGIN.bottom, 1);

  /**
   * The scales from the values of `now`, less the centres of the columns,
   * to CSS pixels of the frame: the values of the columns are their
   * distances from their centres, and the axes' with centres of 0.
   */
  const scalesOf = (
    now: View2d,
    xCentre: number,
    yCentre: number,
  ): { x: ScaleLinear; y: ScaleLinear } => ({
    x: scaleLinear()
      .domain([now.left - xCentre, now.right - xCentre])
      .range([MARGIN.left, MARGIN.left + plotWidth()]),
    y: scaleLinear()
      .domain([now.bottom - yCentre, now.top - yCentre])
      .range([MARGIN.top + plotHeight(), MARGIN.top]),
  });

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
      const { x: xScale, y: yScale } = scalesOf(view, x.centre, y.centre);
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
      const point = svgElement("path", { class: "plot-scatter2d-point" });
      layers[0].append(point);
      return point;
    });
    styled = null;
    layerOf = new Uint8Array(count);
    placedFor = null;
    madeFor = { x: given.x.values, y: given.y.values, placed: given.placed.rows };
  };

  /** Gives each point its style, touching only the points whose style changed. */
  const stylePoints = (style: PointStyle, hover: number | null): void => {
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
      const layer = pointLayer(row, hover, mark);
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
    const { x: xScale, y: yScale } = scalesOf(view, x.centre, y.centre);
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
    // A pan keeps the spans, but for the last bits of their sums.
    const sameSpan = (a: number, b: number): boolean =>
      Math.abs(a - b) <= SAME_SPAN_SHARE * Math.abs(b);
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
    const { x, y } = scalesOf(now, 0, 0);
    const line = (x1: number, y1: number, x2: number, y2: number, into: SVGGElement): void => {
      const drawn = svgElement("line", { class: "plot-scatter2d-line" });
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
      const drawn = svgElement("text", { class: className });
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
      const below = bottom + TICK_PX + X_TICK_TEXT_DROP_PX;
      text(tickText(value), { x: px, y: below }, "middle", "plot-scatter2d-tick");
    }
    for (const value of y.ticks(Math.max(Math.floor((bottom - top) / Y_TICK_SPACING_PX), 2))) {
      const py = y(value);
      line(left, py, right, py, grid);
      line(left - TICK_PX, py, left, py, axes);
      const beside = { x: left - TICK_PX - Y_TICK_TEXT_GAP_PX, y: py + Y_TICK_TEXT_RAISE_PX };
      text(tickText(value), beside, "end", "plot-scatter2d-tick");
    }
    line(left, bottom, right, bottom, axes);
    line(left, top, left, bottom, axes);
    const [xTitle, yTitle] = given.titles;
    const under = { x: (left + right) / 2, y: height - X_TITLE_RAISE_PX };
    text(xTitle, under, "middle", "plot-scatter2d-title");
    const turned = text(yTitle, { x: 0, y: 0 }, "middle", "plot-scatter2d-title");
    const middle = String((top + bottom) / 2);
    turned.setAttribute(
      "transform",
      `translate(${String(Y_TITLE_INSET_PX)},${middle}) rotate(-90)`,
    );
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

  const local = (event: MouseEvent): { x: number; y: number } => placeOnFrame(frame, event);

  const onPointerDown = (event: PointerEvent): void => {
    // A second finger neither pans nor takes the first one's place.
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    // A drag that leaves the frame still pans, or still draws its lasso.
    frame.setPointerCapture(event.pointerId);
    if (data?.lasso.kind === "off") {
      pan = local(event);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pan === null || view === null || event.buttons === 0 || !event.isPrimary) {
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

  // The capture went with no release, as when a menu of the system opens
  // during the drag: the pan ends, or a later drag would jump from its press.
  const onLostCapture = (): void => {
    pan = null;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const pixels = wheelPixels(event.deltaY, event.deltaMode, event.ctrlKey);
    const { fx, fy } = shareOf(local(event).x, local(event).y);
    zoomAt(wheelZoom(pixels), fx, fy);
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
    const moved = rect.width !== width || rect.height !== height;
    width = rect.width;
    height = rect.height;
    input.resize(width, height, pixelRatio());
    screen = null;
    if (moved) {
      // The points moved on the screen, under the lasso and the pointer.
      input.viewMoved();
    }
    requestDraw();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(frame);
  const unwatchDensity = watchDensity(resize);
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", onSchemeChange);
  frame.addEventListener("pointerdown", onPointerDown);
  frame.addEventListener("pointermove", onPointerMove);
  frame.addEventListener("pointerup", onPointerUp);
  frame.addEventListener("pointercancel", onPointerUp);
  frame.addEventListener("lostpointercapture", onLostCapture);
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
        // Both or neither: a row is placed with a value on each axis.
        const xRange = rangeOf(given.x.values, given.placed.rows);
        const yRange = rangeOf(given.y.values, given.placed.rows);
        const x = xRange ?? NO_RANGE;
        const y = yRange ?? NO_RANGE;
        home = homeView(
          { min: given.x.centre + x.min, max: given.x.centre + x.max },
          { min: given.y.centre + y.min, max: given.y.centre + y.max },
        );
        // Framed the first time there are values; a change of them keeps
        // the view.
        if (view === null || !framedOnValues) {
          view = home;
          framedOnValues = xRange !== null && yRange !== null;
        }
        // The points moved on the screen, under the lasso and the pointer.
        input.viewMoved();
      }
      stylePoints(given.style, given.hover);
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
      unwatchDensity();
      scheme.removeEventListener("change", onSchemeChange);
      frame.removeEventListener("pointerdown", onPointerDown);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerup", onPointerUp);
      frame.removeEventListener("pointercancel", onPointerUp);
      frame.removeEventListener("lostpointercapture", onLostCapture);
      frame.removeEventListener("wheel", onWheel);
      frame.removeEventListener("dblclick", frameHome);
      svg.removeEventListener("keydown", onKeyDown);
      input.destroy();
      frame.remove();
    },
  };
}
