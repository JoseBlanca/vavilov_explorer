import { nothing, render } from "lit-html";

import {
  countingOf,
  countriesHolding,
  countryCounts,
  countryCountsText,
  countryLabelText,
  groupsWords,
  levelsOfShape,
  rowsOfCodes,
} from "../../state/countryCounts.ts";
import type { CountryCounts, Counting } from "../../state/countryCounts.ts";
import { defect } from "../../state/defect.ts";
import { copyName } from "../../state/tileCopy.ts";
import type { CountryLevel, TableDescription } from "../../state/description.ts";
import { groupsModel } from "../../state/groups.ts";
import type { ColumnId } from "../../state/ids.ts";
import type { Click } from "../../state/pointClick.ts";
import { countRows, intersection, selectionAfterClick } from "../../state/rowSet.ts";
import type { Widget } from "../../state/widget.ts";
import { NO_WEBGL_WORDS } from "../../state/widgetMessages.ts";
import { createCountryMap } from "../../plots/countryMap.ts";
import type { CountryShape } from "../../plots/worldShapes.ts";
import { answered } from "../shared/answered.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { countText } from "../shared/numbers.ts";
import { slot } from "../shared/slot.ts";
import { canDrawWebGl } from "../shared/webgl.ts";
import { countryLegendView } from "./countryLegend.view.ts";
import { cannotDrawTile } from "./pointViewTile.controller.ts";
import { plotTileView } from "./plotTile.view.ts";
import type { PlotTile, TileContext } from "./tile.ts";

/**
 * What the tile draws of its column: the column's levels, its codes, whose
 * individuals it counts, and their counts.
 */
interface Counted {
  readonly levels: readonly CountryLevel[];
  readonly codes: Uint16Array;
  readonly counting: Counting;
  readonly counts: CountryCounts;
}

/**
 * Draws the map of countries of `widget` in its tile `element`, of the Maps
 * window: the title bar with its name, "Map of countries in origin", and
 * the button that asks `onClose` to close it; the map of the countries of
 * its column, each filled by how many individuals it holds, of every
 * individual or of those in the groups selected, with a legend over its
 * corner, drawn from the window's copy of the state; and under it the count
 * of the individuals it counts. The pointer over a country shows its label;
 * a click on a country selects the individuals it counts there, or none
 * when they were the selection, Cmd-click or Ctrl-click adds them to the
 * selection or, when all are selected, takes them away; while + or − is
 * pressed, the click puts them in the group or takes them out
 * (docs/design.md, section 2.2). On a computer that cannot draw WebGL here,
 * the tile says so in the map's place.
 */
export function createCountryMapTile(
  element: HTMLElement,
  widget: Widget,
  copy: number,
  context: TileContext,
  onClose: () => void,
): PlotTile {
  const { id, spec } = widget;
  if (spec.kind !== "countryMap") {
    throw defect(`a map of countries' tile for a widget of the kind ${spec.kind}`);
  }
  const column = spec.country;
  const { connection, label, report } = context;
  const { state } = connection;
  let name = "";
  const cannotDraw = canDrawWebGl() ? null : NO_WEBGL_WORDS;
  const drawTile = (): void => {
    render(
      plotTileView({
        titleId: `tile-${String(id)}`,
        name,
        onClose,
        legend: true,
        cannotDraw,
      }),
      element,
    );
  };
  const nameOf = (description: TableDescription): string =>
    copyName(`Map of countries in ${columnOf(description, column).name}`, copy);
  drawTile();
  if (cannotDraw !== null) {
    return cannotDrawTile(element, (description) => {
      name = nameOf(description);
      drawTile();
    });
  }

  let counted: Counted | null = null;
  /** The country under the pointer, by its place in the map's list, and where the pointer is. */
  let hovered: { countryIndex: number; place: { x: number; y: number } } | null = null;
  /** Whether the tile was closed: nothing is drawn after. */
  let destroyed = false;

  /** The shape of the country at `countryIndex` in the map's list. */
  const shapeOf = (countryIndex: number): CountryShape => {
    const shape = map.countries[countryIndex];
    if (shape === undefined) {
      throw defect(`a country ${String(countryIndex)} of no shape`);
    }
    return shape;
  };

  const count = createInfoBar(
    slot(element, "count"),
    state,
    {
      aspects: [],
      text: () => (counted === null ? null : countryCountsText(counted.counts, countText)),
    },
    () => {
      map.focus();
    },
  );

  const showLabel = (): void => {
    if (hovered === null || counted === null) {
      label.hide();
      return;
    }
    const shape = shapeOf(hovered.countryIndex);
    label.show(countryLabelText(shape, counted.counts, counted.levels, countText), hovered.place);
  };

  /**
   * Selects the individuals of `country` alone, those the map counts there,
   * or none when they were the selection; or, with a toggle, adds them to
   * the selection, or takes them away when all of them are in it. A country
   * of no individual changes nothing, as a click on empty space does in a
   * point view, since a selection cannot be undone.
   */
  /** The selection before the last click that changed it, which a double click puts back. */
  let beforeClick: Uint8Array | null = null;
  const select = (countryIndex: number, click: Exclude<Click, "range">): void => {
    beforeClick = null;
    const { numeric } = shapeOf(countryIndex);
    const now = state.selection();
    // A shape with no ISO code holds no individual.
    if (numeric === null || counted === null || now === null) {
      return;
    }
    const rows = intersection(
      rowsOfCodes(counted.codes, levelsOfShape(counted.levels, numeric)),
      counted.counting.kind === "groups" ? counted.counting.rows : null,
    );
    if (countRows(rows) === 0) {
      return;
    }
    const bits = selectionAfterClick(now, rows, click);
    beforeClick = now;
    connection
      .setSelection(bits)
      .then(answered("selecting", draw, report, null))
      .catch(report);
  };
  const undoClick = (): void => {
    const before = beforeClick;
    beforeClick = null;
    if (before !== null) {
      connection
        .setSelection(before)
        .then(answered("selecting", draw, report, null))
        .catch(report);
    }
  };

  const map = createCountryMap(slot(element, "plot"), {
    onHover: (countryIndex, place) => {
      const was = hovered;
      hovered = countryIndex === null || place === null ? null : { countryIndex, place };
      // The label is the window's: a tile the pointer did not leave keeps
      // its hands off another tile's.
      if (hovered !== null || was !== null) {
        showLabel();
      }
    },
    onClick: select,
    onClickUndone: undoClick,
    onThemeChange: () => {
      draw();
    },
  });
  const hasShape = new Set(
    map.countries.flatMap((country) => (country.numeric === null ? [] : [country.numeric])),
  );

  const draw = (): void => {
    const now = context.table.current();
    const codes = state.codes(column);
    if (destroyed || now === null || codes === null) {
      return;
    }
    const levels = levelsOf(now, column);
    // Every individual, or those of the groups selected in the active
    // classification.
    const active = state.active();
    const classificationCodes = active === null ? null : state.codes(active.column);
    const counting: Counting =
      classificationCodes === null
        ? { kind: "all" }
        : countingOf(
            groupsModel(now, active, state.codes, context.decimalMark).rows,
            classificationCodes,
          );
    const counts = countryCounts(codes, levels, (numeric) => hasShape.has(numeric), counting);
    counted = { levels, codes, counting, counts };
    const selection = state.selection();
    map.update({
      name,
      counts: counts.byShape,
      largest: counts.largest,
      outlined: selection === null ? new Set() : countriesHolding(selection, codes, levels),
    });
    render(
      countryLegendView({
        largest: counts.largest,
        groups: groupsWords(counts.whose, countText),
        countWords: countText,
      }),
      slot(element, "legend"),
    );
    count.recount();
    if (hovered !== null) {
      showLabel();
    }
  };

  // The classification holds the groups selected, which the map counts.
  const unsubscribes = (["codes", "selection", "classification"] as const).map((aspect) =>
    state.subscribe(aspect, draw),
  );

  return {
    described: (description) => {
      name = nameOf(description);
      drawTile();
      draw();
    },
    focus: () => {
      map.focus();
    },
    forgetPointer: () => undefined,
    // A map of countries draws no lasso: + or − with a click acts at once.
    lassoWaiting: () => false,
    applyLasso: () => undefined,
    dropLasso: () => undefined,
    plot: map,
    destroy: () => {
      destroyed = true;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      if (hovered !== null) {
        label.hide();
      }
      count.destroy();
      render(nothing, slot(element, "legend"));
      map.destroy();
      render(nothing, element);
    },
  };
}

/** The column `id` of the table. */
function columnOf(
  description: TableDescription,
  id: ColumnId,
): TableDescription["columns"][number] {
  const found = description.columns.find((column) => column.id === id);
  if (found === undefined) {
    throw defect(`a map of countries of column ${String(id)}, not in the table`);
  }
  return found;
}

/** The levels of the column of countries `id`. */
function levelsOf(description: TableDescription, id: ColumnId): readonly CountryLevel[] {
  const found = columnOf(description, id);
  if (found.role !== "country") {
    throw defect(`a map of countries of column ${String(id)}, which is no column of countries`);
  }
  return found.levels;
}
