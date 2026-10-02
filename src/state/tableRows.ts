// What the table of the main window shows: its columns, and for each row
// on screen its cells, from the description of the table, the page of rows
// fetched for it, the codes of the window's copy and the selection
// (docs/design.md, section 2.1). The cells of a categorical column are read
// from the copy's codes, which every lasso keeps up to date, and not from the
// page, so a page is fetched only for the numbers and the texts.

import { integerText, levelText, numberText } from "./cellText.ts";
import type { Cell } from "./cellText.ts";
import { defect } from "./defect.ts";
import type { Role, StorageType, TableDescription } from "./description.ts";
import { NO_CODE } from "./ids.ts";
import type { ColumnId, RowIndex } from "./ids.ts";
import type { RowPage } from "./rowPage.ts";
import { roleChoices } from "./roles.ts";
import type { RoleChoice } from "./roles.ts";
import { hasRow } from "./rowSet.ts";

/** A column of the table as its header shows it. */
export interface TableColumn {
  /** Its id; the first column, the names, has one too. */
  readonly id: ColumnId;
  /** Its name, as in the user's file; the first column's may be empty. */
  readonly name: string;
  /** The first column, or the role of another. */
  readonly kind: "names" | Role;
  /** Whether its values line up at the end of the cell, as numbers do. */
  readonly alignEnd: boolean;
  /** The roles it can take, none for the first column. */
  readonly choices: readonly RoleChoice[];
}

/** A row on screen. */
export interface TableRow {
  /** Its row in the table. */
  readonly row: RowIndex;
  /** Whether the individual is in the selection. */
  readonly selected: boolean;
  /** Its cells, one per column, or `null` while its page is being fetched. */
  readonly cells: readonly Cell[] | null;
}

/** Whether the values of `storage` line up at the end of the cell. */
function isNumeric(storage: StorageType): boolean {
  return storage === "integer" || storage === "float";
}

/** Every column of the table, the names first. */
export function tableColumns(description: TableDescription): TableColumn[] {
  return [
    {
      id: description.names.id,
      name: description.names.header,
      kind: "names",
      alignEnd: false,
      choices: [],
    },
    ...description.columns.map((column) => ({
      id: column.id,
      name: column.name,
      kind: column.role,
      alignEnd: isNumeric(column.storage),
      choices: roleChoices(column),
    })),
  ];
}

/** The columns a page is fetched for: the numbers and the texts, in order. */
export function fetchedColumns(description: TableDescription): ColumnId[] {
  return description.columns.flatMap((column) =>
    column.role === "number" || column.role === "text" ? [column.id] : [],
  );
}

/**
 * The row `row` as the table draws it, from `page` when it holds the row.
 *
 * @throws A defect when the page lacks a column of the description or the
 * row, or a code has no level: the window asked for them, and the backend
 * makes the rest impossible.
 */
export function tableRow(
  description: TableDescription,
  page: RowPage | null,
  row: RowIndex,
  codesOf: (column: ColumnId) => Uint16Array | null,
  selection: Uint8Array | null,
  decimalMark: string,
): TableRow {
  const selected = selection !== null && hasRow(selection, row);
  if (page === null) {
    return { row, selected, cells: null };
  }
  const index = row - page.first;
  const name = page.names[index];
  if (index < 0 || name === undefined) {
    throw defect(
      `row ${String(row)} drawn from a page of ${String(page.count)} rows from row ${String(page.first)}`,
    );
  }
  const cells: Cell[] = [{ kind: "value", text: name, align: "start" }];
  for (const column of description.columns) {
    if (column.role === "number" || column.role === "text") {
      cells.push(pageCell(page, column.id, index, decimalMark));
      continue;
    }
    const code = codesOf(column.id)?.[row];
    if (code === undefined) {
      throw defect(`no code of row ${String(row)} in column ${String(column.id)}`);
    }
    if (code === NO_CODE) {
      cells.push({ kind: "missing" });
      continue;
    }
    const level = column.levels[code];
    if (level === undefined) {
      throw defect(`a code ${String(code)} with no level in column ${String(column.id)}`);
    }
    cells.push({
      kind: "value",
      text: levelText(level.value, column.storage, decimalMark),
      align: isNumeric(column.storage) ? "end" : "start",
    });
  }
  return { row, selected, cells };
}

/** The cell of a number or a text, from its page. */
function pageCell(page: RowPage, id: ColumnId, index: number, decimalMark: string): Cell {
  const column = page.columns.find((candidate) => candidate.id === id);
  if (column === undefined || column.type === "categorical") {
    throw defect(`a page of rows without the values of column ${String(id)}`);
  }
  switch (column.type) {
    case "float": {
      const value = column.values[index];
      return value === undefined || value === null
        ? missingOr(value, id)
        : { kind: "value", text: numberText(value, decimalMark), align: "end" };
    }
    case "integer": {
      const value = column.values[index];
      return value === undefined || value === null
        ? missingOr(value, id)
        : { kind: "value", text: integerText(value), align: "end" };
    }
    case "text": {
      const value = column.values[index];
      return value === undefined || value === null
        ? missingOr(value, id)
        : { kind: "value", text: value, align: "start" };
    }
  }
}

/** A missing cell for `null`; for `undefined`, a row the page lacks, a defect. */
function missingOr(value: null | undefined, id: ColumnId): Cell {
  if (value === undefined) {
    throw defect(`a page of rows whose column ${String(id)} lacks a row`);
  }
  return { kind: "missing" };
}
