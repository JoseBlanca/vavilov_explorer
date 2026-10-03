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

/** What + or − is pressed on: a group, with its name, or the unassigned individuals. */
export type EditTarget =
  | { readonly kind: "group"; readonly code: LevelCode; readonly name: string }
  | { readonly kind: "unassigned" };

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
 * How many selected individuals − would leave unassigned: those in
 * `group`.
 *
 * @throws A defect when the selection and the codes are not of one table.
 */
export function removedCount(selection: Uint8Array, codes: Uint16Array, group: LevelCode): number {
  return countSelected(selection, codes, (value) => value === group);
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
    const done = count === 0 ? "" : `${moved} removed from ${target.name}. `;
    return information(
      `${done}Rows you select now leave ${target.name}${too}, if they are in it, until you press − again or Escape; ${UNDO_EACH}`,
    );
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

/** The informational message after the button `mode` on `target` was released. */
export function releasedMessage(target: EditTarget, mode: EditMode): BarMessage {
  if (target.kind === "unassigned") {
    return information("Rows you select are no longer made unassigned.");
  }
  return information(
    mode === "add"
      ? `Rows you select no longer go to ${target.name}.`
      : `Rows you select no longer leave ${target.name}.`,
  );
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
