// What the table of the main window shows: its columns, and for each row
// on screen its cells, from the description of the table, the page of rows
// fetched for it, the codes of the window's copy and the selection
// (docs/design.md, section 2.1). The cells of a categorical column are read
// from the copy's codes, which every lasso keeps up to date, and not from the
// page, so a page is fetched only for the other columns.

import { booleanText, integerText, numberText } from "./cellText.ts";
import type { Cell } from "./cellText.ts";
import { defect } from "./defect.ts";
import type { TableDescription } from "./description.ts";
import { NO_CODE } from "./ids.ts";
import type { ColumnId, RowIndex } from "./ids.ts";
import type { RowPage } from "./rowPage.ts";
import { hasRow } from "./rowSet.ts";

/** A column of the table as its header shows it. */
export interface TableColumn {
  /** Its id; the first column, the names, has one too. */
  readonly id: ColumnId;
  /** Its name, as in the user's file; the first column's may be empty. */
  readonly name: string;
  /** Its type, `names` for the first column. */
  readonly type: "names" | "numeric" | "integer" | "text" | "boolean" | "categorical";
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

/** Every column of the table, the names first. */
export function tableColumns(description: TableDescription): TableColumn[] {
  return [
    { id: description.names.id, name: description.names.header, type: "names" },
    ...description.columns.map((column) => ({
      id: column.id,
      name: column.name,
      type: column.type,
    })),
  ];
}

/** The columns a page is fetched for: all but the categorical ones, in order. */
export function fetchedColumns(description: TableDescription): ColumnId[] {
  return description.columns.flatMap((column) =>
    column.type === "categorical" ? [] : [column.id],
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
    if (column.type === "categorical") {
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
      cells.push({ kind: "value", text: level.name, align: "start" });
      continue;
    }
    cells.push(pageCell(page, column.id, index, decimalMark));
  }
  return { row, selected, cells };
}

/** The cell of a column other than a categorical one, from its page. */
function pageCell(page: RowPage, id: ColumnId, index: number, decimalMark: string): Cell {
  const column = page.columns.find((candidate) => candidate.id === id);
  if (column === undefined || column.type === "categorical") {
    throw defect(`a page of rows without the values of column ${String(id)}`);
  }
  switch (column.type) {
    case "numeric": {
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
    case "boolean": {
      const value = column.values[index];
      return value === undefined || value === null
        ? missingOr(value, id)
        : { kind: "value", text: booleanText(value), align: "start" };
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
