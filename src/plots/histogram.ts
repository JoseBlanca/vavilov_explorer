// The histogram: the bars of a numeric column's bins, stacked by group, as
// SVG, with an axis of the values below and one of the individuals at the
// left (docs/design.md, section 2.2). It draws what it is given and reports
// the pointer and the clicks; it knows nothing of the backend or a window.

import { scaleLinear } from "d3-scale";

import type { Segment } from "../state/histogram.ts";
import { pointClickOf } from "../state/pointClick.ts";
import { platformOf } from "../state/undoKeys.ts";
import "./plots.css";

const SVG = "http://www.w3.org/2000/svg";

/** The room around the bars for the axes, in CSS pixels. */
const MARGIN = { top: 18, right: 20, bottom: 52, left: 72 } as const;
/** The length of a tick of an axis, in CSS pixels. */
const TICK_PX = 5;
/** The gap between two bars, in CSS pixels. */
const GAP_PX = 1;
/**
 * The width of the line around the individuals selected in a segment, in
 * CSS pixels, as plots.css draws it, which insets the line by half of it.
 */
const OUTLINE_WIDTH_PX = 2;

/** What the histogram draws. */
export interface HistogramData {
  /** The name of the plot, which a screen reader reads, the window's title. */
  readonly name: string;
  /** The name of the column, below the axis of the values. */
  readonly columnName: string;
  /** The left edge of the first bin, the right edge of the last, and how many bins there are. */
  readonly lowest: number;
  readonly highest: number;
  readonly binCount: number;
  /** The segments, bar by bar, bottom to top in each, with their colours as CSS writes them. */
  readonly segments: readonly Segment[];
  /** The most individuals in one bar. */
  readonly tallest: number;
  /** Writes a value of the axis of the values, with the decimal mark of the system's region. */
  readonly valueText: (value: number) => string;
  /** Writes a count of the axis of the individuals, in the user's language. */
  readonly countText: (value: number) => string;
}

/** What the histogram reports. */
export interface HistogramEvents {
  /**
   * The pointer is over the segment at `segment`, by its place in
   * {@link HistogramData.segments}, at `place` in CSS pixels of the
   * window, or over none.
   */
  readonly onHover: (segment: number | null, place: { x: number; y: number } | null) => void;
  /**
   * A click on the segment at `segment`: alone, with Cmd or Ctrl to add its
   * individuals or take them away, or with Shift to select a run of bins.
   */
  readonly onClick: (segment: number, click: "select" | "toggle" | "range") => void;
}

/** A histogram drawn in its element. */
export interface Histogram {
  /** Draws `data`. */
  readonly update: (data: HistogramData) => void;
  /** The centre of the segment at `segment` in CSS pixels of the window, or `null` when it is not drawn. */
  readonly placeOf: (segment: number) => { x: number; y: number } | null;
  /** Gives the plot the keyboard's focus. */
  readonly focus: () => void;
}

/** An SVG element of `name`, with `attributes`. */
function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Readonly<Record<string, string | number>>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

/**
 * A histogram in `element`, which it fills, drawn again at each `update`
 * and when the element changes size. A click on a segment and the pointer
 * over one go to `events`; a click on Ctrl on macOS, the system's
 * secondary click, does nothing.
 */
export function createHistogram(element: HTMLElement, events: HistogramEvents): Histogram {
  const platform = platformOf(navigator.userAgent);
  const frame = document.createElement("div");
  frame.className = "plot-frame";
  const svg = svgElement("svg", { class: "plot-canvas plot-histogram", role: "img" });
  // Focused by the window when the information bar gives the focus back;
  // not in the order of Tab, since its bars have no keys yet.
  svg.setAttribute("tabindex", "-1");
  frame.append(svg);
  element.replaceChildren(frame);
  let shown: HistogramData | null = null;

  const segmentAt = (target: EventTarget | null): number | null => {
    if (!(target instanceof Element)) {
      return null;
    }
    const found = target.closest("[data-segment]")?.getAttribute("data-segment");
    return found === undefined || found === null ? null : Number(found);
  };

  svg.addEventListener("pointermove", (event) => {
    const segment = segmentAt(event.target);
    events.onHover(segment, segment === null ? null : { x: event.clientX, y: event.clientY });
  });
  svg.addEventListener("pointerleave", () => {
    events.onHover(null, null);
  });
  svg.addEventListener("click", (event) => {
    const segment = segmentAt(event.target);
    if (segment === null) {
      return;
    }
    if (event.shiftKey) {
      events.onClick(segment, "range");
      return;
    }
    const click = pointClickOf(event, platform);
    if (click !== "none") {
      events.onClick(segment, click);
    }
  });
  // A Shift-click must not select the text of the axes.
  svg.addEventListener("mousedown", (event) => {
    if (event.shiftKey) {
      event.preventDefault();
    }
  });

  const draw = (): void => {
    if (shown === null) {
      return;
    }
    const data = shown;
    const width = Math.max(frame.clientWidth, MARGIN.left + MARGIN.right + 1);
    const height = Math.max(frame.clientHeight, MARGIN.top + MARGIN.bottom + 1);
    svg.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
    svg.setAttribute("aria-label", data.name);
    const bottom = height - MARGIN.bottom;
    const x = scaleLinear()
      .domain([data.lowest, data.highest])
      .range([MARGIN.left, width - MARGIN.right]);
    const y = scaleLinear()
      .domain([0, Math.max(data.tallest, 1)])
      .range([bottom, MARGIN.top])
      .nice(5);
    const binWidth = (data.highest - data.lowest) / data.binCount;
    const edge = (bin: number): number => x(data.lowest + bin * binWidth);

    const bars = svgElement("g", {});
    const outlines = svgElement("g", { class: "plot-histogram-outlines" });
    data.segments.forEach((segment, index) => {
      const left = edge(segment.bin) + GAP_PX / 2;
      const barWidth = Math.max(edge(segment.bin + 1) - edge(segment.bin) - GAP_PX, 1);
      const top = y(segment.bottom + segment.count);
      const rect = svgElement("rect", {
        "data-segment": index,
        x: left,
        y: top,
        width: barWidth,
        height: Math.max(y(segment.bottom) - top, 0),
      });
      rect.style.fill = segment.colour;
      bars.append(rect);
      if (segment.selected > 0) {
        const selectedTop = y(segment.bottom + segment.selected);
        const box = {
          x: left + OUTLINE_WIDTH_PX / 2,
          y: selectedTop + OUTLINE_WIDTH_PX / 2,
          width: Math.max(barWidth - OUTLINE_WIDTH_PX, 0),
          height: Math.max(y(segment.bottom) - selectedTop - OUTLINE_WIDTH_PX, 0),
        };
        outlines.append(
          svgElement("rect", { ...box, class: "plot-histogram-halo" }),
          svgElement("rect", { ...box, class: "plot-histogram-outline" }),
        );
      }
    });

    const axes = svgElement("g", { class: "plot-histogram-axes", "aria-hidden": "true" });
    axes.append(
      svgElement("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: bottom, y2: bottom }),
      svgElement("line", { x1: MARGIN.left, x2: MARGIN.left, y1: MARGIN.top, y2: bottom }),
    );
    for (const value of x.ticks(Math.max(Math.floor((width - MARGIN.left) / 90), 2))) {
      const at = x(value);
      const text = svgElement("text", { x: at, y: bottom + TICK_PX + 14, "text-anchor": "middle" });
      text.textContent = data.valueText(value);
      axes.append(svgElement("line", { x1: at, x2: at, y1: bottom, y2: bottom + TICK_PX }), text);
    }
    // Whole individuals alone.
    for (const value of y.ticks(5).filter((tick) => Number.isInteger(tick))) {
      const at = y(value);
      const text = svgElement("text", {
        x: MARGIN.left - TICK_PX - 3,
        y: at,
        "text-anchor": "end",
        "dominant-baseline": "middle",
      });
      text.textContent = data.countText(value);
      axes.append(
        svgElement("line", { x1: MARGIN.left - TICK_PX, x2: MARGIN.left, y1: at, y2: at }),
        text,
      );
    }
    const columnTitle = svgElement("text", {
      class: "plot-histogram-title",
      x: (MARGIN.left + width - MARGIN.right) / 2,
      y: height - 8,
      "text-anchor": "middle",
    });
    columnTitle.textContent = data.columnName;
    const countTitle = svgElement("text", {
      class: "plot-histogram-title",
      transform: `translate(16 ${String((MARGIN.top + bottom) / 2)}) rotate(-90)`,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
    });
    countTitle.textContent = "Individuals";
    axes.append(columnTitle, countTitle);
    svg.replaceChildren(bars, outlines, axes);
  };

  new ResizeObserver(draw).observe(frame);

  return {
    update: (data) => {
      shown = data;
      draw();
    },
    placeOf: (segment) => {
      const rect = svg.querySelector(`[data-segment="${String(segment)}"]`);
      if (rect === null) {
        return null;
      }
      const box = rect.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    },
    focus: () => {
      svg.focus();
    },
  };
}
