// What + and − pressed on the selected group of the panel do to the
// individuals selected, counted from the window's copy so that the
// information bar can say it, and the words it says when a button is
// pressed and released (docs/design.md, section 2.1).

import type { BarMessage } from "./barMessages.ts";
import { defect } from "./defect.ts";
import { NO_CODE } from "./ids.ts";
import type { LevelCode } from "./ids.ts";
import type { EditMode, Selected } from "./message.ts";
import { hasRow } from "./rowSet.ts";

/**
 * What + or − is pressed on: a group, with its name, the unassigned
 * individuals, or several groups, with their names, which only − acts on.
 */
export type EditTarget =
  | { readonly kind: "group"; readonly code: LevelCode; readonly name: string }
  | { readonly kind: "unassigned" }
  | { readonly kind: "groups"; readonly names: readonly string[] };

/**
 * How many selected individuals + would change: those not in `target`
 * already, by the codes of the active classification, `NO_CODE` for an
 * unassigned one.
 *
 * @throws A defect when the selection and the codes are not of one table.
 */
export function addedCount(selection: Uint8Array, codes: Uint16Array, target: Selected): number {
  const wanted = target.kind === "unassigned" ? NO_CODE : target.code;
  return countSelected(selection, codes, (value) => value !== wanted);
}

/**
 * How many selected individuals − would leave unassigned: those in one of
 * `groups`.
 *
 * @throws A defect when the selection and the codes are not of one table.
 */
export function removedCount(
  selection: Uint8Array,
  codes: Uint16Array,
  groups: readonly LevelCode[],
): number {
  return countSelected(selection, codes, (value) => groups.some((group) => group === value));
}

/**
 * The informational message after + or −, `mode`, was pressed on `target`
 * and changed `count` of the individuals selected, with `countWords`
 * writing the number in the user's language.
 */
export function pressedMessage(
  count: number,
  target: EditTarget,
  mode: EditMode,
  countWords: (value: number) => string,
): BarMessage {
  const moved = individuals(count, countWords);
  const too = count === 0 ? "" : " too";
  if (mode === "remove") {
    if (target.kind === "unassigned") {
      throw defect("− pressed on the unassigned individuals");
    }
    const names = targetWords(target, countWords);
    const inIt = target.kind === "group" ? "if they are in it" : "if they are in one of them";
    const done = count === 0 ? "" : `${moved} removed from ${names}. `;
    return information(
      `${done}Rows you select now leave ${names}${too}, ${inIt}, until you press − again or Escape; ${UNDO_EACH}`,
    );
  }
  if (target.kind === "groups") {
    throw defect("+ pressed on several groups");
  }
  if (target.kind === "unassigned") {
    const done = count === 0 ? "" : `${moved} made unassigned. `;
    return information(
      `${done}Rows you select are now made unassigned${too}, until you press + again or Escape; ${UNDO_EACH}`,
    );
  }
  const done = count === 0 ? "" : `${moved} added to ${target.name}. `;
  return information(
    `${done}Rows you select now go to ${target.name}${too}, until you press + again or Escape; ${UNDO_EACH}`,
  );
}

/**
 * The informational message after the button `mode` on `target` was
 * released, with `countWords` writing a number in the user's language.
 */
export function releasedMessage(
  target: EditTarget,
  mode: EditMode,
  countWords: (value: number) => string,
): BarMessage {
  if (target.kind === "unassigned") {
    return information("Rows you select are no longer made unassigned.");
  }
  const names = targetWords(target, countWords);
  return information(
    mode === "add"
      ? `Rows you select no longer go to ${names}.`
      : `Rows you select no longer leave ${names}.`,
  );
}

/**
 * The groups of `target` as the bar and the buttons name them: a group by
 * its name, two as "Spain and Peru", and more as "the 3 selected groups".
 */
export function targetWords(
  target: Exclude<EditTarget, { readonly kind: "unassigned" }>,
  countWords: (value: number) => string,
): string {
  if (target.kind === "group") {
    return target.name;
  }
  const [first, second, ...rest] = target.names;
  if (first !== undefined && second !== undefined && rest.length === 0) {
    return `${first} and ${second}`;
  }
  return `the ${countWords(target.names.length)} selected groups`;
}

/**
 * The informational message after the group `name` was deleted, and its
 * `count` individuals left unassigned, with `countWords` writing the number
 * in the user's language.
 */
export function deletedMessage(
  name: string,
  count: number,
  countWords: (value: number) => string,
): BarMessage {
  const undo = "Edit > Undo brings it back.";
  if (count === 0) {
    return information(`The group ${name}, which had no individuals, was deleted. ${undo}`);
  }
  const verb = count === 1 ? "is" : "are";
  return information(
    `The group ${name} was deleted, and its ${individuals(count, countWords)} ${verb} unassigned now. ${undo}`,
  );
}

/** How the information bar says that each change of a button pressed can be undone. */
const UNDO_EACH = "Edit > Undo takes back each change.";

function information(text: string): BarMessage {
  return { kind: "information", text };
}

/** "1 individual", "34 individuals". */
function individuals(count: number, countWords: (value: number) => string): string {
  return `${countWords(count)} ${count === 1 ? "individual" : "individuals"}`;
}

/** How many rows of `selection` have a code that `counts`. */
function countSelected(
  selection: Uint8Array,
  codes: Uint16Array,
  counts: (code: number) => boolean,
): number {
  if (selection.length !== Math.ceil(codes.length / 8)) {
    throw defect(
      `a selection of ${String(selection.length)} bytes for ${String(codes.length)} codes`,
    );
  }
  let count = 0;
  codes.forEach((value, row) => {
    if (hasRow(selection, row) && counts(value)) {
      count += 1;
    }
  });
  return count;
}
