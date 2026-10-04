import { render } from "lit-html";

import { connect } from "../../backend/connection.ts";
import { tauriTransport } from "../../backend/transport.ts";
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
import type { CountryLevel, TableDescription } from "../../state/description.ts";
import { groupsModel } from "../../state/groups.ts";
import type { ColumnId } from "../../state/ids.ts";
import { countRows, intersection, toggledRows } from "../../state/rowSet.ts";
import { createCountryMap } from "../../plots/countryMap.ts";
import type { CountryShape } from "../../plots/worldShapes.ts";
import { answered } from "../shared/answered.ts";
import { createDescribedTable } from "../shared/describedTable.ts";
import { createGroupsPanel } from "../shared/groupsPanel.controller.ts";
import { createInfoBar } from "../shared/infoBar.controller.ts";
import { countText } from "../shared/numbers.ts";
import { startPlotFrame } from "../shared/plotWindow.controller.ts";
import { slot } from "../shared/slot.ts";
import { createTextLabel } from "../shared/textLabel.controller.ts";
import { countryLegendView } from "./countryLegend.view.ts";

/**
 * What the window draws of its column: the column's levels, its codes,
 * whose individuals it counts, and their counts.
 */
interface Counted {
  readonly levels: readonly CountryLevel[];
  readonly codes: Uint16Array;
  readonly counting: Counting;
  readonly counts: CountryCounts;
}

/**
 * Starts the window of a map of countries in `root`: the frame, the bar of
 * a defect, the connection to the backend, and the map of the countries of
 * its column, each filled by how many individuals it holds, of every
 * individual or of those in the groups selected, with a legend, drawn from
 * the window's copy of the state. The pointer over a country shows its
 * label; a click on a country selects the individuals it counts there,
 * Cmd-click or Ctrl-click adds them to the selection or, when all are
 * selected, takes them away. Its groups panel offers the classification,
 * the groups and + and −, while which a click puts a country's individuals
 * in the group or takes them out (docs/design.md, section 2.2). The window is named after its
 * column, "Map of countries in origin". The backend closes it when a load
 * or a change of role leaves the column no country.
 */
export async function startCountryMapWindow(root: HTMLElement): Promise<void> {
  const defectBar = startPlotFrame(root, "Map of countries", { legend: true, webGl: true });
  if (defectBar === null) {
    return;
  }
  try {
    const connection = await connect(tauriTransport(), defectBar.show);
    const { state } = connection;
    const spec = await connection.describeWidget();
    if (spec.kind !== "countryMap") {
      throw defect(`a map of countries' window for a widget of the kind ${spec.kind}`);
    }
    const column = spec.country;
    const decimalMark = await connection.regionDecimalMark();
    const table = createDescribedTable(connection);
    const label = createTextLabel(slot(root, "label"));
    let counted: Counted | null = null;
    /** The country under the pointer, by its place in the map's list, and where the pointer is. */
    let hovered: { countryIndex: number; place: { x: number; y: number } } | null = null;

    /** The shape of the country at `countryIndex` in the map's list. */
    const shapeOf = (countryIndex: number): CountryShape => {
      const shape = map.countries[countryIndex];
      if (shape === undefined) {
        throw defect(`a country ${String(countryIndex)} of no shape`);
      }
      return shape;
    };

    const infoBar = createInfoBar(
      slot(root, "info"),
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
     * Selects the individuals of `country` alone, those the map counts
     * there; or, with a toggle, adds them to the selection, or takes them
     * away when all of them are in it.
     * A country of no individual changes nothing, as a click on empty space
     * does in a point view, since a selection cannot be undone.
     */
    const select = (countryIndex: number, click: "select" | "toggle"): void => {
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
      const bits = click === "toggle" ? toggledRows(now, rows) : rows;
      connection.setSelection(bits).then(answered("selecting", draw)).catch(defectBar.show);
    };

    const map = createCountryMap(slot(root, "plot"), {
      onHover: (countryIndex, place) => {
        hovered = countryIndex === null || place === null ? null : { countryIndex, place };
        showLabel();
      },
      onClick: select,
      onThemeChange: () => {
        draw();
      },
    });
    const hasShape = new Set(
      map.countries.flatMap((country) => (country.numeric === null ? [] : [country.numeric])),
    );

    const draw = (): void => {
      const now = table.current();
      const codes = state.codes(column);
      if (now === null || codes === null) {
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
              groupsModel(now, active, state.codes, decimalMark).rows,
              classificationCodes,
            );
      const counts = countryCounts(codes, levels, (numeric) => hasShape.has(numeric), counting);
      counted = { levels, codes, counting, counts };
      const selection = state.selection();
      map.update({
        name: document.title,
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
        slot(root, "legend"),
      );
      infoBar.recount();
      showLabel();
    };

    const describe = async (): Promise<void> => {
      const described = await table.fetch();
      document.title = `Map of countries in ${columnOf(described, column).name}`;
      draw();
      groups.redraw();
    };

    state.subscribe("table", () => {
      describe().catch(defectBar.show);
    });
    // The classification holds the groups selected, which the map counts.
    for (const aspect of ["codes", "selection", "classification"] as const) {
      state.subscribe(aspect, draw);
    }
    const groups = createGroupsPanel(
      slot(root, "panel"),
      connection,
      table.now,
      decimalMark,
      infoBar.tell,
      defectBar.show,
      "assigning",
    );
    if (import.meta.env.DEV) {
      // For the e2e tests alone, which click a country where it is drawn;
      // a build for users has no such name.
      Reflect.set(globalThis, "__vavilovPlot", map);
    }
    await describe();
  } catch (error: unknown) {
    defectBar.show(error);
  }
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
