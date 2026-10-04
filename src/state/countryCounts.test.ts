import { describe, expect, test } from "vitest";

import { NO_CODE, isLevelCode } from "./ids.ts";
import type { LevelCode } from "./ids.ts";
import type { CountryLevel } from "./description.ts";
import type { GroupRow } from "./groups.ts";
import { hasRow } from "./rowSet.ts";
import {
  countColour,
  countingOf,
  countryCounts,
  countryCountsText,
  countryLabelText,
  groupsWords,
  levelsOfShape,
  rowsOfCodes,
  countriesHolding,
} from "./countryCounts.ts";
import type { Counting } from "./countryCounts.ts";

/** Spain, Peru, French Guiana, which the map draws inside France, and the USSR, a former country. */
const LEVELS: readonly CountryLevel[] = [
  { value: "ESP", colour: "#e69f00", country: { name: "Spain", numeric: "724" } },
  { value: "PER", colour: "#56b4e9", country: { name: "Peru", numeric: "604" } },
  { value: "GUF", colour: "#009e73", country: { name: "French Guiana", numeric: "254" } },
  {
    value: "SUN",
    colour: "#f0e442",
    country: { name: "Soviet Union", numeric: null },
  },
];

const SHAPES = new Set(["724", "604", "250"]);
const hasShape = (numeric: string): boolean => SHAPES.has(numeric);

/** Three in Spain, one in Peru, one with none, two in French Guiana and one in the USSR. */
const CODES = new Uint16Array([0, 0, 1, NO_CODE, 2, 0, 2, 3]);

const words = (value: number): string => value.toLocaleString("en");

/** Every individual counted, with no group selected. */
const ALL: Counting = { kind: "all" };

/** The rows of a set of rows, one bit each, among the first `numRows`. */
function rowsIn(bits: Uint8Array, numRows: number): number[] {
  return [...Array(numRows).keys()].filter((row) => hasRow(bits, row));
}

describe("countryCounts", () => {
  test("counts the individuals of each shape, and those the map cannot draw", () => {
    const counts = countryCounts(CODES, LEVELS, hasShape, ALL);
    expect([...counts.byShape]).toEqual([
      ["724", 3],
      ["604", 1],
    ]);
    expect(counts.largest).toBe(3);
    expect(counts.counted).toBe(4);
    expect(counts.numRows).toBe(8);
    expect(counts.missing).toBe(1);
    expect(counts.unshaped).toEqual([
      { name: "French Guiana", count: 2 },
      { name: "Soviet Union", count: 1 },
    ]);
  });

  test("leaves out the countries of no individual", () => {
    const counts = countryCounts(new Uint16Array([1, NO_CODE]), LEVELS, hasShape, ALL);
    expect([...counts.byShape]).toEqual([["604", 1]]);
    expect(counts.unshaped).toEqual([]);
  });

  test("a code with no level is a defect", () => {
    expect(() => countryCounts(new Uint16Array([7]), LEVELS, hasShape, ALL)).toThrow(
      /defect: code 7 of a column of 4 countries/,
    );
  });
});

/**
 * The codes of another classification of the same eight individuals, the
 * farm: North (0) and South (1), and two unassigned.
 */
const FARMS = new Uint16Array([0, 1, 0, 0, NO_CODE, 1, 0, NO_CODE]);

function levelCode(value: number): LevelCode {
  if (!isLevelCode(value)) throw new Error("not a level code");
  return value;
}

/** The rows of the panel for the farms, with those of `chosen` selected, by name or `null` for the unassigned. */
function farmRows(chosen: readonly (string | null)[]): readonly GroupRow[] {
  const row = (name: string | null, code: number | null, count: number): GroupRow => ({
    selected: code === null ? { kind: "unassigned" } : { kind: "group", code: levelCode(code) },
    name,
    colour: name === null ? null : "#e69f00",
    count,
    isSelected: chosen.includes(name),
    showsPlus: false,
    showsMinus: false,
  });
  return [row("North", 0, 4), row("South", 1, 2), row(null, null, 2)];
}

describe("countingOf", () => {
  test("counts every individual with no group selected", () => {
    expect(countingOf(farmRows([]), FARMS)).toEqual({ kind: "all" });
  });

  test("counts the individuals of the groups selected, the unassigned among them", () => {
    const north = countingOf(farmRows(["North"]), FARMS);
    expect(north.kind === "groups" ? north.names : null).toEqual(["North"]);
    expect(north.kind === "groups" ? rowsIn(north.rows, 8) : null).toEqual([0, 2, 3, 6]);
    const unassigned = countingOf(farmRows(["South", null]), FARMS);
    expect(unassigned.kind === "groups" ? unassigned.names : null).toEqual(["South", null]);
    expect(unassigned.kind === "groups" ? rowsIn(unassigned.rows, 8) : null).toEqual([1, 4, 5, 7]);
  });
});

describe("countryCounts of the groups selected", () => {
  test("counts their individuals alone, and those of them the map cannot draw", () => {
    // North holds one in Spain, one in Peru, one with none and one in French Guiana.
    const counts = countryCounts(CODES, LEVELS, hasShape, countingOf(farmRows(["North"]), FARMS));
    expect([...counts.byShape]).toEqual([
      ["724", 1],
      ["604", 1],
    ]);
    expect(counts.largest).toBe(1);
    expect(counts.counted).toBe(2);
    expect(counts.numRows).toBe(8);
    expect(counts.missing).toBe(1);
    expect(counts.unshaped).toEqual([{ name: "French Guiana", count: 1 }]);
    expect(counts.whose).toEqual({ kind: "groups", names: ["North"], individuals: 4 });
  });

  test("of the column of countries itself leaves only those countries", () => {
    const spain = countryCounts(
      CODES,
      LEVELS,
      hasShape,
      countingOf(
        [
          {
            selected: { kind: "group", code: levelCode(0) },
            name: "ESP",
            colour: "#e69f00",
            count: 3,
            isSelected: true,
            showsPlus: true,
            showsMinus: true,
          },
        ],
        CODES,
      ),
    );
    expect([...spain.byShape]).toEqual([["724", 3]]);
  });

  test("of rows of another table is a defect", () => {
    expect(() =>
      countryCounts(CODES, LEVELS, hasShape, {
        kind: "groups",
        names: ["North"],
        rows: new Uint8Array(3),
      }),
    ).toThrow(/defect/);
  });
});

describe("groupsWords", () => {
  test("names the groups selected, up to three, and counts the others", () => {
    const named = (names: readonly (string | null)[]): string | null =>
      groupsWords({ kind: "groups", names, individuals: 1 }, words);
    expect(groupsWords({ kind: "all" }, words)).toBe(null);
    expect(named(["ESP"])).toBe("in ESP");
    expect(named(["ESP", "PER"])).toBe("in ESP and PER");
    expect(named(["ESP", "PER", "MEX", "ARG"])).toBe("in ESP, PER, MEX and 1 other group");
    expect(named(["ESP", "PER", "MEX", "ARG", "CHL", "BOL", "ECU"])).toBe(
      "in ESP, PER, MEX and 4 other groups",
    );
  });

  test("names the unassigned individuals as those in no group", () => {
    const named = (names: readonly (string | null)[]): string | null =>
      groupsWords({ kind: "groups", names, individuals: 1 }, words);
    expect(named([null])).toBe("in no group");
    expect(named(["ESP", null])).toBe("in ESP and in no group");
    expect(named(["ESP", "PER", null])).toBe("in ESP and PER, and in no group");
  });
});

describe("countryCountsText", () => {
  const base = { byShape: new Map(), largest: 0, unshaped: [], whose: ALL };

  test("says every individual is counted when none is left out", () => {
    expect(countryCountsText({ ...base, counted: 2000, numRows: 2000, missing: 0 }, words)).toBe(
      "Counting all 2,000 individuals.",
    );
    expect(countryCountsText({ ...base, counted: 1, numRows: 1, missing: 0 }, words)).toBe(
      "Counting the one individual.",
    );
  });

  test("says how many have no country and where the others are", () => {
    expect(
      countryCountsText(
        {
          ...base,
          counted: 1920,
          numRows: 2000,
          missing: 60,
          unshaped: [{ name: "French Guiana", count: 20 }],
        },
        words,
      ),
    ).toBe(
      "Counting 1,920 of 2,000 individuals: 60 have no country, and 20 are in French Guiana, which the map has no shape for.",
    );
    expect(countryCountsText({ ...base, counted: 3, numRows: 4, missing: 1 }, words)).toBe(
      "Counting 3 of 4 individuals: 1 has no country.",
    );
  });

  test("names up to three places the map has no shape for, and counts the others", () => {
    const unshaped = [
      { name: "French Guiana", count: 4 },
      { name: "Réunion", count: 3 },
      { name: "Gibraltar", count: 2 },
      { name: "Tuvalu", count: 1 },
      { name: "Tokelau", count: 1 },
    ];
    expect(
      countryCountsText({ ...base, counted: 9, numRows: 20, missing: 0, unshaped }, words),
    ).toBe(
      "Counting 9 of 20 individuals: 11 are in French Guiana, Réunion, Gibraltar and 2 other places, which the map has no shape for.",
    );
    expect(
      countryCountsText(
        { ...base, counted: 9, numRows: 10, missing: 0, unshaped: unshaped.slice(3, 4) },
        words,
      ),
    ).toBe("Counting 9 of 10 individuals: 1 is in Tuvalu, which the map has no shape for.");
    expect(
      countryCountsText(
        { ...base, counted: 0, numRows: 7, missing: 0, unshaped: unshaped.slice(0, 2) },
        words,
      ),
    ).toBe(
      "Counting 0 of 7 individuals: 7 are in French Guiana and Réunion, which the map has no shape for.",
    );
  });

  test("says whose individuals are counted when groups are selected", () => {
    const of = (names: readonly (string | null)[], individuals: number) =>
      ({ kind: "groups", names, individuals }) as const;
    expect(
      countryCountsText(
        { ...base, counted: 312, numRows: 2000, missing: 0, whose: of(["ESP", "PER"], 312) },
        words,
      ),
    ).toBe("Counting the 312 individuals in ESP and PER, of 2,000.");
    expect(
      countryCountsText(
        { ...base, counted: 1, numRows: 2000, missing: 0, whose: of(["ESP"], 1) },
        words,
      ),
    ).toBe("Counting the one individual in ESP, of 2,000.");
    expect(
      countryCountsText(
        { ...base, counted: 300, numRows: 2000, missing: 12, whose: of(["ESP", "PER"], 312) },
        words,
      ),
    ).toBe("Counting 300 of the 312 individuals in ESP and PER: 12 have no country.");
    expect(
      countryCountsText(
        { ...base, counted: 0, numRows: 2000, missing: 2, whose: of([null], 2) },
        words,
      ),
    ).toBe("Counting 0 of the 2 individuals in no group: 2 have no country.");
    expect(
      countryCountsText(
        { ...base, counted: 0, numRows: 2000, missing: 0, whose: of(["ESP"], 0) },
        words,
      ),
    ).toBe("Counting no individuals: none of the 2,000 are in ESP.");
  });
});

describe("countColour", () => {
  const colours = {
    empty: [0.5, 0.5, 0.5],
    low: [0.8, 0.9, 1],
    high: [0, 0.2, 0.4],
  } as const;

  test("gives a country of no individual the empty colour, and the others the ramp", () => {
    expect(countColour(0, 5, colours)).toEqual([0.5, 0.5, 0.5]);
    expect(countColour(1, 5, colours)).toEqual([0.8, 0.9, 1]);
    expect(countColour(5, 5, colours)).toEqual([0, 0.2, 0.4]);
    const [red, green, blue] = countColour(3, 5, colours);
    expect(red).toBeCloseTo(0.4, 9);
    expect(green).toBeCloseTo(0.55, 9);
    expect(blue).toBeCloseTo(0.7, 9);
  });

  test("gives the most individuals the high end, also when the most is 1", () => {
    expect(countColour(1, 1, colours)).toEqual([0, 0.2, 0.4]);
  });
});

describe("the rows and the shapes of the countries", () => {
  test("the rows of a set of codes are their bits", () => {
    expect([...rowsOfCodes(CODES, new Set([0]))]).toEqual([0b0010_0011]);
    expect([...rowsOfCodes(CODES, new Set([2, 3]))]).toEqual([0b1101_0000]);
    expect([...rowsOfCodes(CODES, new Set())]).toEqual([0]);
  });

  test("the levels of a shape are those whose country it is", () => {
    expect([...levelsOfShape(LEVELS, "604")]).toEqual([1]);
    expect([...levelsOfShape(LEVELS, "250")]).toEqual([]);
  });

  test("the countries holding the selection are those of its individuals", () => {
    // Rows 2, in Peru, 3, with none, 4, in French Guiana, and 7, in the USSR.
    expect([...countriesHolding(new Uint8Array([0b1001_1100]), CODES, LEVELS)]).toEqual([
      "604",
      "254",
    ]);
    expect([...countriesHolding(new Uint8Array([0b0010_0001]), CODES, LEVELS)]).toEqual(["724"]);
  });
});

describe("countryLabelText", () => {
  const counts = countryCounts(CODES, LEVELS, hasShape, ALL);

  test("names a country of the column by its name and code, with its individuals", () => {
    expect(countryLabelText({ numeric: "724", name: "Spain" }, counts, LEVELS, words)).toBe(
      "Spain (ESP): 3 individuals",
    );
    expect(countryLabelText({ numeric: "604", name: "Peru" }, counts, LEVELS, words)).toBe(
      "Peru (PER): 1 individual",
    );
  });

  test("names a country of no individual by the map's name", () => {
    expect(countryLabelText({ numeric: "504", name: "Morocco" }, counts, LEVELS, words)).toBe(
      "Morocco: no individuals",
    );
    // France holds French Guiana's shape, but French Guiana's individuals are not counted in it.
    expect(countryLabelText({ numeric: "250", name: "France" }, counts, LEVELS, words)).toBe(
      "France: no individuals",
    );
  });
});

describe("the places the map has no shape for", () => {
  const FORMER_FIRST: readonly CountryLevel[] = [
    {
      value: "SUN",
      colour: "#f0e442",
      country: { name: "Soviet Union", numeric: null },
    },
    { value: "REU", colour: "#e69f00", country: { name: "Réunion", numeric: "638" } },
    { value: "GUF", colour: "#009e73", country: { name: "French Guiana", numeric: "254" } },
    { value: "MTQ", colour: "#56b4e9", country: { name: "Martinique", numeric: "474" } },
  ];

  test("come the most individuals first, whatever the order of the levels", () => {
    // One in the USSR, the first level, and three in French Guiana.
    const counts = countryCounts(new Uint16Array([0, 2, 2, 2]), FORMER_FIRST, hasShape, ALL);
    expect(counts.unshaped.map((place) => place.name)).toEqual(["French Guiana", "Soviet Union"]);
  });

  test("of as many individuals come in the order of their names", () => {
    const counts = countryCounts(new Uint16Array([3, 2, 1]), FORMER_FIRST, hasShape, ALL);
    expect(counts.unshaped.map((place) => place.name)).toEqual([
      "French Guiana",
      "Martinique",
      "Réunion",
    ]);
  });

  test("past three are counted as one other place", () => {
    const counts = countryCounts(new Uint16Array([0, 1, 2, 3]), FORMER_FIRST, hasShape, ALL);
    expect(countryCountsText(counts, words)).toBe(
      "Counting 0 of 4 individuals: 4 are in French Guiana, Martinique, Réunion and 1 other place, which the map has no shape for.",
    );
  });
});

describe("the label of a country whose name is not the map's", () => {
  test("names it by the name the core gives it", () => {
    const congo: readonly CountryLevel[] = [
      {
        value: "COD",
        colour: "#e69f00",
        country: { name: "Democratic Republic of the Congo", numeric: "180" },
      },
    ];
    const counts = countryCounts(new Uint16Array([0, 0]), congo, () => true, ALL);
    expect(
      countryLabelText({ numeric: "180", name: "Dem. Rep. Congo" }, counts, congo, words),
    ).toBe("Democratic Republic of the Congo (COD): 2 individuals");
    expect(countryLabelText({ numeric: null, name: "Somaliland" }, counts, congo, words)).toBe(
      "Somaliland: no individuals",
    );
  });
});
