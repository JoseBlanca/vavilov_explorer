// A command the backend refused, as the core's CommandError crosses to a
// window: its kind and its fields, in camelCase
// (crates/vavilov-core/src/error.rs). The table below is the one list of
// them on this side, and the type is made from it.

/** The fields of each kind of refusal, and whether each is a number or a text. */
const FIELDS = {
  noProject: {},
  madeBeforeLoad: { basedOn: "number", loadedAt: "number" },
  unknownWindow: { label: "string" },
  unknownColumn: { column: "number" },
  notCategorical: { column: "number" },
  notActiveClassification: { column: "number" },
  unknownLevel: { column: "number", code: "number", numLevels: "number" },
  noPopulationSelected: {},
  notSelectedPopulation: { code: "number" },
  rowSetLength: { numRows: "number", numBytes: "number" },
  rowSetUnusedBits: { numRows: "number" },
  rowOutOfRange: { row: "number", numRows: "number" },
  nothingToUndo: {},
  nothingToRedo: {},
  tooManyRows: { numRows: "number", maxRows: "number" },
  tooManyColumns: { numColumns: "number", maxColumns: "number" },
  emptyIndividual: { row: "number" },
  duplicateIndividual: { name: "string", firstRow: "number", secondRow: "number" },
  emptyColumnName: { position: "number" },
  duplicateColumnName: { name: "string" },
  columnLength: { column: "string", numValues: "number", numRows: "number" },
  nonFiniteNumber: { column: "string", row: "number" },
  tooManyLevels: { column: "string", numLevels: "number", maxLevels: "number" },
  emptyLevelName: { column: "string", code: "number" },
  duplicateLevel: { column: "string", level: "string" },
  codeWithoutLevel: { column: "string", row: "number", code: "number", numLevels: "number" },
  defect: { what: "string" },
} as const satisfies Record<string, Record<string, "number" | "string">>;

type Fields = typeof FIELDS;

/** Why the backend refused a command; a refused command changed nothing. */
export type CommandError = {
  [K in keyof Fields]: { readonly kind: K } & {
    readonly [F in keyof Fields[K]]: Fields[K][F] extends "number" ? number : string;
  };
}[keyof Fields];

const FIELDS_OF_KIND: ReadonlyMap<string, Readonly<Record<string, "number" | "string">>> = new Map(
  Object.entries(FIELDS),
);

/**
 * Whether `value` is a refusal of the backend: an object with a known kind
 * and exactly the fields of that kind, each of its type.
 */
export function isCommandError(value: unknown): value is CommandError {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const { kind } = value;
  if (typeof kind !== "string") {
    return false;
  }
  const fields = FIELDS_OF_KIND.get(kind);
  if (fields === undefined) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== Object.keys(fields).length + 1) {
    return false;
  }
  return entries.every(([name, field]) => {
    if (name === "kind") {
      return true;
    }
    const expected = Object.hasOwn(fields, name) ? fields[name] : undefined;
    return expected !== undefined && typeof field === expected;
  });
}
