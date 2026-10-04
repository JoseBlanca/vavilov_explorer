// The operators of the find bar and the condition each makes: which ones a
// column offers, the condition when the user picks another operator or
// another column, and the words of a filter the backend cleared
// (docs/design.md, section 2.1).

import type { BarMessage } from "./barMessages.ts";
import type { TableDescription } from "./description.ts";
import type { Comparison, Condition, Filter } from "./filter.ts";
import { isLevelCode } from "./ids.ts";
import type { ColumnId } from "./ids.ts";

/** An operator of the find bar: "contains", "is", "is missing", or a comparison. */
export type Operator = "contains" | "is" | "missing" | Comparison;

/**
 * What a column searched holds, which sets its operators: texts, a column
 * of text, the IDs or any column; the groups of a category or a column of
 * countries; or numbers, a number, a latitude or a longitude.
 */
export type Searched = "texts" | "groups" | "numbers";

/** The operators each kind of column offers, in the order of the dropdown. */
export const OPERATORS: Readonly<Record<Searched, readonly Operator[]>> = {
  texts: ["contains", "is", "missing"],
  groups: ["contains", "is", "missing"],
  numbers: ["equal", "less", "atMost", "greater", "atLeast", "missing"],
};

/** What the column `column` of `description` holds; any column, `null`, holds texts. */
export function searchedOf(description: TableDescription, column: ColumnId | null): Searched {
  const found = description.columns.find((each) => each.id === column);
  switch (found?.role) {
    case undefined:
    case "text":
      return "texts";
    case "category":
    case "country":
      return "groups";
    case "number":
    case "latitude":
    case "longitude":
      return "numbers";
  }
}

/** The operator of `condition`: "is" for a group chosen from a list. */
export function operatorOf(condition: Condition): Operator {
  switch (condition.kind) {
    case "contains":
    case "is":
    case "missing":
      return condition.kind;
    case "group":
      return "is";
    case "compare":
      return condition.comparison;
  }
}

/**
 * The text of `condition` as its field shows it: the text or the number
 * typed, the name of its group from `groupNames`, the names of the groups
 * by their codes, or nothing.
 */
export function conditionText(condition: Condition, groupNames: readonly string[]): string {
  switch (condition.kind) {
    case "contains":
    case "is":
    case "compare":
      return condition.text;
    case "group":
      return condition.code === null ? "" : (groupNames[condition.code] ?? "");
    case "missing":
      return "";
  }
}

/**
 * The condition of `operator` on a column of `searched`, whose groups are
 * named `groupNames` by their codes, keeping the text of `previous`: "is"
 * on a column of groups chooses the group that text names, case ignored,
 * or none.
 */
export function conditionOf(
  operator: Operator,
  searched: Searched,
  previous: Condition,
  groupNames: readonly string[],
): Condition {
  const text = conditionText(previous, groupNames);
  switch (operator) {
    case "contains":
      return { kind: "contains", text };
    case "is": {
      if (searched !== "groups") {
        return { kind: "is", text };
      }
      if (previous.kind === "group") {
        return previous;
      }
      const wanted = text.normalize("NFC").toLowerCase();
      const found = groupNames.findIndex((name) => name.normalize("NFC").toLowerCase() === wanted);
      return { kind: "group", code: wanted !== "" && isLevelCode(found) ? found : null };
    }
    case "missing":
      return { kind: "missing" };
    case "less":
    case "atMost":
    case "equal":
    case "atLeast":
    case "greater":
      return { kind: "compare", comparison: operator, text };
  }
}

/**
 * The condition when the user chooses another column, of `searched` with
 * groups named `groupNames`, from one whose groups were `oldGroupNames`:
 * its operator when the new column offers it, else the column's first,
 * with its text.
 */
export function conditionForColumn(
  condition: Condition,
  oldGroupNames: readonly string[],
  searched: Searched,
  groupNames: readonly string[],
): Condition {
  // A group's code means nothing in another column: it goes by its name.
  const previous: Condition =
    condition.kind === "group"
      ? { kind: "is", text: conditionText(condition, oldGroupNames) }
      : condition;
  const operator = operatorOf(condition);
  const offered = OPERATORS[searched];
  const kept = offered.includes(operator) ? operator : offered[0];
  return conditionOf(kept ?? "contains", searched, previous, groupNames);
}

/**
 * The information shown when the backend cleared the filter `before` to
 * `after`, with `names` the name of its column and, for a group, of the
 * group: the group was deleted when the column `stillGroups`, else the
 * column changed role; `null` when `after` is not `before` cleared, or
 * `before` filtered nothing.
 */
export function clearedFilterMessage(
  before: Filter,
  after: Filter,
  names: { readonly column: string; readonly group: string | null },
  stillGroups: boolean,
): BarMessage | null {
  if (before.column !== after.column || !hasValue(before.condition) || hasValue(after.condition)) {
    return null;
  }
  if (before.condition.kind === "group" && stillGroups) {
    return {
      kind: "information",
      text: `The filter on ${names.group ?? names.column} was removed: the group was deleted.`,
    };
  }
  return {
    kind: "information",
    text: `The filter on ${names.column} was removed: its column changed role.`,
  };
}

/** Whether `condition` filters: a text, a number or a group given, or "is missing". */
function hasValue(condition: Condition): boolean {
  switch (condition.kind) {
    case "contains":
    case "is":
    case "compare":
      return condition.text !== "";
    case "group":
      return condition.code !== null;
    case "missing":
      return true;
  }
}
