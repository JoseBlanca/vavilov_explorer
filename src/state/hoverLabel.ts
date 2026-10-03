// What the label of the individual under the pointer in a point view says:
// its ID, its group in the active classification, and its values in the
// first three columns of the table that are neither the IDs nor the active
// classification (decided by the owner on 3 October 2026, docs/design.md,
// section 2.2).

import { at } from "./at.ts";
import { integerText, levelText, numberText } from "./cellText.ts";
import { defect } from "./defect.ts";
import { isCategoricalColumn } from "./description.ts";
import type { ColumnDescription, TableDescription } from "./description.ts";
import type { ColumnId } from "./ids.ts";
import { NO_CODE } from "./ids.ts";
import type { RowPage } from "./rowPage.ts";

/** How many columns the label shows besides the ID and the group. */
export const LABEL_COLUMNS = 3;

/** The words a missing value is shown with in the label. */
const MISSING = "missing";
/** The group of an unassigned individual, as the groups panel names it. */
const UNASSIGNED = "Unassigned";

/** One line of the label: a column's name and the individual's value in it. */
export interface LabelLine {
  /** The column's name. */
  readonly name: string;
  /** The value as the label writes it, or "missing". */
  readonly value: string;
}

/** The label: the individual's ID, then its lines. */
export interface HoverLabel {
  /** The individual's ID. */
  readonly title: string;
  /** The group, then the values of the label's columns. */
  readonly lines: readonly LabelLine[];
}

/** The columns whose values the label shows, given the active classification. */
export function labelColumns(
  description: TableDescription,
  active: ColumnId | null,
): readonly ColumnDescription[] {
  return description.columns.filter((column) => column.id !== active).slice(0, LABEL_COLUMNS);
}

/** The text of the level `code` of `column`, or the words of a missing value or of no group. */
function levelWords(column: ColumnDescription, code: number, decimalMark: string): string | null {
  if (!isCategoricalColumn(column)) {
    return null;
  }
  if (code === NO_CODE) {
    return null;
  }
  const level = column.levels[code];
  if (level === undefined) {
    throw defect(`code ${String(code)} of column ${String(column.id)}, which has no such level`);
  }
  return levelText(level.value, column.storage, decimalMark);
}

/**
 * The label of the one row of `page`, a row fetched with the columns of
 * {@link labelColumns} in their order, with its group read from `groupCode`,
 * its code in the active classification, or `null` with none.
 *
 * @throws A defect when the page is not of one row, or its columns are not
 * those of the label.
 */
export function hoverLabel(
  description: TableDescription,
  active: ColumnId | null,
  groupCode: number | null,
  page: RowPage,
  decimalMark: string,
): HoverLabel {
  const [title] = page.names;
  if (page.count !== 1 || title === undefined) {
    throw defect(`a label of a page of ${String(page.count)} rows`);
  }
  const lines: LabelLine[] = [];
  if (active !== null && groupCode !== null) {
    const column = description.columns.find((each) => each.id === active);
    if (column === undefined) {
      throw defect(`an active classification ${String(active)} not in the table`);
    }
    lines.push({
      name: column.name,
      value: levelWords(column, groupCode, decimalMark) ?? UNASSIGNED,
    });
  }
  const columns = labelColumns(description, active);
  if (columns.length !== page.columns.length) {
    throw defect(`a label of ${String(page.columns.length)} columns for ${String(columns.length)}`);
  }
  columns.forEach((column, index) => {
    const values = page.columns[index];
    if (values?.id !== column.id) {
      throw defect(`column ${String(values?.id)} in the place of ${String(column.id)} in a label`);
    }
    let value: string;
    switch (values.type) {
      case "float": {
        const number = at(values.values, 0);
        value = number === null ? MISSING : numberText(number, decimalMark);
        break;
      }
      case "integer": {
        const number = at(values.values, 0);
        value = number === null ? MISSING : integerText(number);
        break;
      }
      case "text":
        value = at(values.values, 0) ?? MISSING;
        break;
      case "categorical":
        value = levelWords(column, at(values.codes, 0) ?? NO_CODE, decimalMark) ?? MISSING;
        break;
    }
    lines.push({ name: column.name, value });
  });
  return { title, lines };
}
