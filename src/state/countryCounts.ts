// What the map of countries draws of a column of countries: how many
// individuals each country's shape holds, and those it cannot draw, with no
// country or in a place the map has no shape for (docs/design.md, section
// 2.2); whose individuals it counts, every one or those of the groups
// selected; the colour of each count, and the rows of a country.

import { at } from "./at.ts";
import { defect } from "./defect.ts";
import type { CountryLevel } from "./description.ts";
import type { GroupRow } from "./groups.ts";
import { NO_CODE } from "./ids.ts";
import type { Rgb } from "./pointStyle.ts";
import { hasRow, rowsWhere } from "./rowSet.ts";
import { holdsCode } from "./selectedGroups.ts";

/**
 * Whose individuals the map counts: every one, with no group selected, or
 * those of the groups selected in the active classification (decided by the
 * owner on 4 October 2026).
 */
export type Counting =
  | { readonly kind: "all" }
  | {
      readonly kind: "groups";
      /** The names of the groups selected, in the panel's order, `null` for the unassigned individuals. */
      readonly names: readonly (string | null)[];
      /** Their individuals, one bit per row of the table. */
      readonly rows: Uint8Array;
    };

/** Whose individuals were counted, as the bar and the legend name them. */
export type Whose =
  | { readonly kind: "all" }
  | {
      readonly kind: "groups";
      /** The names of the groups selected, `null` for the unassigned individuals. */
      readonly names: readonly (string | null)[];
      /** How many individuals they hold, those the map cannot draw included. */
      readonly individuals: number;
    };

/** A country of the column the map has no shape for, and how many individuals it holds. */
export interface Unshaped {
  /** Its common name. */
  readonly name: string;
  /** Its individuals. */
  readonly count: number;
}

/** How the individuals of a column of countries fall on the map. */
export interface CountryCounts {
  /** The individuals of each country the map draws, by the ISO numeric code of its shape. */
  readonly byShape: ReadonlyMap<string, number>;
  /** The most individuals in one shape, 0 with none. */
  readonly largest: number;
  /** The individuals counted on the map. */
  readonly counted: number;
  /** The rows of the table. */
  readonly numRows: number;
  /** Whose individuals were counted. */
  readonly whose: Whose;
  /** The individuals counted with no country. */
  readonly missing: number;
  /**
   * The countries with individuals that the map has no shape for, the most
   * individuals first, and those of as many in the order of their names.
   */
  readonly unshaped: readonly Unshaped[];
}

/**
 * Whose individuals the map counts, from the `rows` of the groups panel,
 * those selected in the active classification, whose `codes` the column of
 * the classification holds: every individual when no row is selected.
 */
export function countingOf(rows: readonly GroupRow[], codes: Uint16Array): Counting {
  const chosen = rows.filter((row) => row.isSelected);
  if (chosen.length === 0) {
    return { kind: "all" };
  }
  const selected = chosen.map((row) => row.selected);
  return {
    kind: "groups",
    names: chosen.map((row) => row.name),
    rows: rowsWhere(codes.length, (row) => {
      const code = at(codes, row);
      return holdsCode(selected, code === NO_CODE ? null : code);
    }),
  };
}

/**
 * The counts of `codes`, the codes of a column of countries whose levels
 * are `levels`, of the individuals of `counting`, with `hasShape` saying
 * which ISO numeric codes the map has a shape for.
 *
 * @throws A defect for a code with no level, or for rows of another table.
 */
export function countryCounts(
  codes: Uint16Array,
  levels: readonly CountryLevel[],
  hasShape: (numeric: string) => boolean,
  counting: Counting,
): CountryCounts {
  if (counting.kind === "groups" && counting.rows.length !== Math.ceil(codes.length / 8)) {
    throw defect(
      `the rows of groups in ${String(counting.rows.length)} bytes for ${String(codes.length)} codes`,
    );
  }
  const perLevel = new Array<number>(levels.length).fill(0);
  let missing = 0;
  let individuals = 0;
  for (const [row, code] of codes.entries()) {
    if (counting.kind === "groups" && !hasRow(counting.rows, row)) {
      continue;
    }
    individuals += 1;
    if (code === NO_CODE) {
      missing += 1;
    } else if (code < levels.length) {
      perLevel[code] = at(perLevel, code) + 1;
    } else {
      throw defect(`code ${String(code)} of a column of ${String(levels.length)} countries`);
    }
  }
  const byShape = new Map<string, number>();
  const unshaped: Unshaped[] = [];
  levels.forEach((level, code) => {
    const count = at(perLevel, code);
    const { country } = level;
    if (count === 0) {
      return;
    }
    if (country.numeric !== null && hasShape(country.numeric)) {
      byShape.set(country.numeric, (byShape.get(country.numeric) ?? 0) + count);
    } else {
      unshaped.push({ name: country.name, count });
    }
  });
  const counted = [...byShape.values()].reduce((sum, count) => sum + count, 0);
  return {
    byShape,
    largest: Math.max(0, ...byShape.values()),
    counted,
    numRows: codes.length,
    whose:
      counting.kind === "all"
        ? { kind: "all" }
        : { kind: "groups", names: counting.names, individuals },
    missing,
    unshaped: unshaped.toSorted((a, b) =>
      a.count === b.count ? a.name.localeCompare(b.name) : b.count - a.count,
    ),
  };
}

/**
 * The label of the country under the pointer, `shape`, with its ISO numeric
 * code and its name on the map: "Spain (ESP): 312 individuals", by its
 * common name and the code the table shows when the column has it, or "Morocco:
 * no individuals".
 */
export function countryLabelText(
  shape: { readonly numeric: string | null; readonly name: string },
  counts: CountryCounts,
  levels: readonly CountryLevel[],
  countWords: (value: number) => string,
): string {
  const { numeric } = shape;
  // A shape with no ISO code holds no individual; a former country has
  // no code either, and is not this shape.
  const count = numeric === null ? undefined : counts.byShape.get(numeric);
  const level = levels.find((each) => numeric !== null && each.country.numeric === numeric);
  if (count === undefined || level === undefined) {
    return `${shape.name}: no individuals`;
  }
  const individuals = count === 1 ? "individual" : "individuals";
  return `${level.country.name} (${String(level.value)}): ${countWords(count)} ${individuals}`;
}

/** How many groups a line names before it counts the others. */
const NAMED_GROUPS = 3;

/**
 * The groups of `whose` as the bar and the legend name them, with
 * `countWords` writing a count in the user's language: "in ESP and PER",
 * "in ESP, PER, MEX and 4 other groups", "in no group" for the unassigned
 * individuals, "in ESP and in no group"; `null` for every individual.
 */
export function groupsWords(whose: Whose, countWords: (value: number) => string): string | null {
  if (whose.kind === "all") {
    return null;
  }
  const groups = whose.names.filter((name) => name !== null);
  const named = groups.slice(0, NAMED_GROUPS);
  const others = groups.length - named.length;
  if (others > 0) {
    named.push(`${countWords(others)} other ${others === 1 ? "group" : "groups"}`);
  }
  const inGroups = named.length === 0 ? null : `in ${listed(named)}`;
  if (!whose.names.includes(null)) {
    return inGroups;
  }
  if (inGroups === null) {
    return "in no group";
  }
  // A comma keeps "in ESP and PER, and in no group" from reading as one list.
  return `${inGroups}${named.length > 1 ? "," : ""} and in no group`;
}

/** How many places a line names before it counts the others. */
const NAMED_PLACES = 3;

/**
 * The line of the information bar of a map of countries, with
 * `countWords` writing a count in the user's language: "Counting all 2,000
 * individuals.", or "Counting 1,920 of 2,000 individuals: 60 have no
 * country, and 20 are in French Guiana, which the map has no shape for.";
 * with groups selected, "Counting the 312 individuals in ESP and PER, of
 * 2,000.", or "Counting 300 of the 312 individuals in ESP and PER: 12 have
 * no country."
 */
export function countryCountsText(
  counts: CountryCounts,
  countWords: (value: number) => string,
): string {
  const { counted, numRows, missing, unshaped, whose } = counts;
  const inGroups = groupsWords(whose, countWords);
  // Of every individual, or of those in the groups selected.
  const individuals = whose.kind === "all" ? numRows : whose.individuals;
  if (inGroups === null && counted === numRows) {
    return numRows === 1
      ? "Counting the one individual."
      : `Counting all ${countWords(numRows)} individuals.`;
  }
  if (inGroups !== null && individuals === 0) {
    return `Counting no individuals: none of the ${countWords(numRows)} are ${inGroups}.`;
  }
  if (inGroups !== null && counted === individuals) {
    return individuals === 1
      ? `Counting the one individual ${inGroups}, of ${countWords(numRows)}.`
      : `Counting the ${countWords(individuals)} individuals ${inGroups}, of ${countWords(numRows)}.`;
  }
  const parts: string[] = [];
  if (missing > 0) {
    parts.push(`${countWords(missing)} ${missing === 1 ? "has" : "have"} no country`);
  }
  if (unshaped.length > 0) {
    const inPlaces = unshaped.reduce((sum, place) => sum + place.count, 0);
    const named = unshaped.slice(0, NAMED_PLACES).map((place) => place.name);
    const others = unshaped.length - named.length;
    if (others > 0) {
      named.push(`${countWords(others)} other ${others === 1 ? "place" : "places"}`);
    }
    parts.push(
      `${countWords(inPlaces)} ${inPlaces === 1 ? "is" : "are"} in ${listed(named)}, which the map has no shape for`,
    );
  }
  const of =
    inGroups === null
      ? `${countWords(numRows)} individuals`
      : individuals === 1
        ? `the one individual ${inGroups}`
        : `the ${countWords(individuals)} individuals ${inGroups}`;
  return `Counting ${countWords(counted)} of ${of}: ${parts.join(", and ")}.`;
}

/** `items` as a sentence lists them: "A", "A and B", "A, B and C". */
function listed(items: readonly string[]): string {
  const last = items.at(-1);
  if (last === undefined) {
    return "";
  }
  const before = items.slice(0, -1);
  return before.length === 0 ? last : `${before.join(", ")} and ${last}`;
}

/**
 * The colour of a country with `count` individuals when the most in one is
 * `largest`: `empty` for none, and from `low` at 1 to `high` at `largest`
 * in a straight line between their red, green and blue, as a CSS gradient
 * mixes them, so that the legend's gradient shows the same colours.
 */
export function countColour(
  count: number,
  largest: number,
  colours: { readonly empty: Rgb; readonly low: Rgb; readonly high: Rgb },
): Rgb {
  if (count <= 0) {
    return colours.empty;
  }
  // The ends are the colours themselves, as the legend's ends are.
  if (count >= largest) {
    return colours.high;
  }
  if (count === 1) {
    return colours.low;
  }
  const share = (count - 1) / (largest - 1);
  const mix = (index: 0 | 1 | 2): number =>
    colours.low[index] + (colours.high[index] - colours.low[index]) * share;
  return [mix(0), mix(1), mix(2)];
}

/**
 * The rows whose code in `codes` is one of `levelCodes`, one bit per row, as
 * the selection has them.
 */
export function rowsOfCodes(codes: Uint16Array, levelCodes: ReadonlySet<number>): Uint8Array {
  return rowsWhere(codes.length, (row) => levelCodes.has(at(codes, row)));
}

/**
 * The levels of `levels` whose country's shape is `numeric`, by their codes,
 * which are their places in the list.
 */
export function levelsOfShape(
  levels: readonly CountryLevel[],
  numeric: string,
): ReadonlySet<number> {
  const found = new Set<number>();
  levels.forEach((level, code) => {
    if (level.country.numeric === numeric) {
      found.add(code);
    }
  });
  return found;
}

/**
 * The ISO numeric codes of the countries that hold an individual of
 * `selection`, one bit per row, by `codes` and `levels`, whether the map
 * has their shapes or not; a former country, with no code, is not among
 * them.
 */
export function countriesHolding(
  selection: Uint8Array,
  codes: Uint16Array,
  levels: readonly CountryLevel[],
): ReadonlySet<string> {
  const found = new Set<string>();
  codes.forEach((code, row) => {
    if (code === NO_CODE || !hasRow(selection, row)) {
      return;
    }
    const level = levels[code];
    if (level === undefined) {
      throw defect(`code ${String(code)} of a column of ${String(levels.length)} countries`);
    }
    const { numeric } = level.country;
    if (numeric !== null) {
      found.add(numeric);
    }
  });
  return found;
}
