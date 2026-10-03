// What the groups panel shows, derived from the window's copy and the
// description of the table: the classifications to choose from, and the
// rows of the active one, each group with its colour and number of
// individuals, and the unassigned individuals last (docs/design.md,
// section 2.1).

import { defect } from "./defect.ts";
import { levelText } from "./cellText.ts";
import { isCategoricalColumn } from "./description.ts";
import type { TableDescription } from "./description.ts";
import { NO_CODE, isLevelCode } from "./ids.ts";
import type { ColumnId, LevelCode } from "./ids.ts";
import type { EditMode, Selected } from "./message.ts";
import { PALETTE } from "./palette.ts";
import type { EditTarget } from "./groupEdit.ts";
import { isRowSelected, removableGroups, singleOf } from "./selectedGroups.ts";
import type { SelectedGroups } from "./selectedGroups.ts";
import type { Active } from "./windowState.ts";

/**
 * The most characters the name of a group of text may have, as
 * `MAX_GROUP_NAME` in the core: 30, decided by the owner on
 * 3 October 2026.
 */
export const MAX_GROUP_NAME = 30;

/** A category the user can make the active classification. */
export interface Classification {
  /** Its id. */
  readonly column: ColumnId;
  /** Its name, as in the user's file. */
  readonly name: string;
}

/** A row of the panel: a group, or the unassigned individuals. */
export interface GroupRow {
  /** What selecting the row selects. */
  readonly selected: Selected;
  /** The group's value as text, or `null` for the unassigned individuals. */
  readonly name: string | null;
  /** The group's colour, `#rrggbb`, or `null` for the unassigned. */
  readonly colour: string | null;
  /** How many individuals it holds. */
  readonly count: number;
  /** Whether it is selected. */
  readonly isSelected: boolean;
  /** Whether it shows +: it is the one row selected. */
  readonly showsPlus: boolean;
  /** Whether it shows −: it is the one row selected, or the last group of several selected. */
  readonly showsMinus: boolean;
}

/** What the panel shows. */
export interface GroupsModel {
  /** Every category, of countries or not, in the order of the table. */
  readonly classifications: readonly Classification[];
  /** The active classification, or `null`. */
  readonly active: ColumnId | null;
  /** The name of the active classification, or `null` with none. */
  readonly activeName: string | null;
  /** Its groups in the order of their codes, then the unassigned; empty with none active. */
  readonly rows: readonly GroupRow[];
  /**
   * Whether a group can be added to it: to a category of TRUE and
   * FALSE only while it lacks one of them, and not with none active.
   */
  readonly takesNewGroups: boolean;
  /**
   * The most characters the name typed for a new group may have, for
   * a category of text; `null` for one of countries, which keeps the code
   * of a long name, or of numbers or of TRUE and FALSE.
   */
  readonly nameLimit: number | null;
  /** What is selected, in the core's order; empty for nothing. */
  readonly selected: SelectedGroups;
  /** The button pressed, + or −, or `null`. */
  readonly mode: EditMode | null;
}

/**
 * The panel's model.
 *
 * @throws A defect when the codes of the active classification do not fit
 * its levels or the table, which the backend makes impossible.
 */
export function groupsModel(
  description: TableDescription,
  active: Active | null,
  codesOf: (column: ColumnId) => Uint16Array | null,
  decimalMark: string,
): GroupsModel {
  const classifications = description.columns.flatMap((column) =>
    isCategoricalColumn(column) ? [{ column: column.id, name: column.name }] : [],
  );
  if (active === null) {
    return {
      classifications,
      active: null,
      activeName: null,
      rows: [],
      takesNewGroups: false,
      nameLimit: null,
      selected: [],
      mode: null,
    };
  }
  const column = description.columns.find((candidate) => candidate.id === active.column);
  if (column === undefined || !isCategoricalColumn(column)) {
    throw defect(`the active classification, column ${String(active.column)}, is not a category`);
  }
  const codes = codesOf(active.column);
  if (codes === null) {
    throw defect(`the active classification, column ${String(active.column)}, has no codes`);
  }
  if (codes.length !== description.numRows) {
    throw defect(
      `${String(codes.length)} codes for the active classification of a table of ${String(description.numRows)} rows`,
    );
  }
  const counts = new Array<number>(column.levels.length).fill(0);
  let unassigned = 0;
  for (const value of codes) {
    if (value === NO_CODE) {
      unassigned += 1;
    } else {
      const count = counts[value];
      if (count === undefined) {
        throw defect(
          `a code ${String(value)} in a classification of ${String(counts.length)} levels`,
        );
      }
      counts[value] = count + 1;
    }
  }
  const single = singleOf(active.selected);
  const groups = removableGroups(active.selected);
  const lastGroup = groups.at(-1);
  /** Whether `row` is selected, and which buttons it shows. */
  const marks = (row: Selected): Pick<GroupRow, "isSelected" | "showsPlus" | "showsMinus"> => {
    const isSelected = isRowSelected(active.selected, row);
    const isSingle = single !== null && isSelected;
    return {
      isSelected,
      showsPlus: isSingle,
      showsMinus:
        isSingle ||
        (single === null &&
          row.kind === "group" &&
          lastGroup !== undefined &&
          row.code === lastGroup),
    };
  };
  const rows: GroupRow[] = column.levels.map((level, index) => {
    const selected: Selected = { kind: "group", code: levelCode(index) };
    const count = counts[index];
    if (count === undefined) {
      throw defect(`no count for level ${String(index)}`);
    }
    return {
      selected,
      name: levelText(level.value, column.storage, decimalMark),
      colour: level.colour,
      count,
      ...marks(selected),
    };
  });
  const unassignedRow: Selected = { kind: "unassigned" };
  rows.push({
    selected: unassignedRow,
    name: null,
    colour: null,
    count: unassigned,
    ...marks(unassignedRow),
  });
  return {
    classifications,
    active: active.column,
    activeName: column.name,
    rows,
    takesNewGroups: column.storage !== "boolean" || column.levels.length < 2,
    nameLimit: column.storage === "text" && column.role === "category" ? MAX_GROUP_NAME : null,
    selected: active.selected,
    mode: active.mode,
  };
}

function levelCode(index: number): LevelCode {
  if (!isLevelCode(index)) {
    throw defect(`a level at ${String(index)}, beyond the codes`);
  }
  return index;
}

/**
 * What + or − acts on, as the bar names it: the one row selected, or the
 * groups selected, or `null` with nothing selected.
 *
 * @throws A defect for the row of a group with no name, which only the
 * unassigned individuals' has.
 */
export function editTargetOf(model: GroupsModel): EditTarget | null {
  const selected = model.rows.filter((row) => row.isSelected);
  const [first, ...rest] = selected;
  if (first === undefined) {
    return null;
  }
  const nameOf = (row: GroupRow): string => {
    if (row.name === null) {
      throw defect(`a row of a group with no name`);
    }
    return row.name;
  };
  if (rest.length > 0) {
    // − acts on the groups among them, the unassigned individuals aside.
    const groups = selected.filter((row) => row.selected.kind === "group");
    const [only, ...others] = groups;
    if (only?.selected.kind === "group" && others.length === 0) {
      return { kind: "group", code: only.selected.code, name: nameOf(only) };
    }
    return { kind: "groups", names: groups.map(nameOf) };
  }
  if (first.selected.kind === "unassigned") {
    return { kind: "unassigned" };
  }
  return { kind: "group", code: first.selected.code, name: nameOf(first) };
}

/** A colour a group edited can take, with its name as a screen reader reads it. */
export interface ColourChoice {
  /** As CSS writes it, `#rrggbb`. */
  readonly colour: string;
  /** Its name, and the other groups that have it: "Sky blue, used by Peru". */
  readonly label: string;
}

/**
 * Every colour of the list, for the group of `edited` among `rows`, each
 * named with the other groups that have it, with `countWords` writing a
 * number in the user's language.
 *
 * @throws A defect for a row with a colour and no name, which only the
 * unassigned individuals' row lacks, and it has no colour either.
 */
export function colourChoices(
  rows: readonly GroupRow[],
  edited: LevelCode,
  countWords: (value: number) => string,
): readonly ColourChoice[] {
  return PALETTE.map(({ colour, name }) => {
    const users = rows.filter(
      (row) =>
        row.colour === colour && !(row.selected.kind === "group" && row.selected.code === edited),
    );
    const [first] = users;
    if (first === undefined) {
      return { colour, label: name };
    }
    if (users.length > 1) {
      return { colour, label: `${name}, used by ${countWords(users.length)} groups` };
    }
    if (first.name === null) {
      throw defect(`the colour ${colour} on a row with no name`);
    }
    return { colour, label: `${name}, used by ${first.name}` };
  });
}
