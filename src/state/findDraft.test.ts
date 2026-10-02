import { describe, expect, test } from "vitest";

import { NO_DRAFT, backendChanged, drawnFilter, edited, sendAnswered } from "./findDraft.ts";
import type { FilterOfLoad, FindStep } from "./findDraft.ts";
import type { Filter } from "./filter.ts";
import { isColumnId, isRevision } from "./ids.ts";
import type { ColumnId } from "./ids.ts";

function column(value: number): ColumnId {
  if (!isColumnId(value)) throw new Error("not a column");
  return value;
}

const ORIGIN = column(2);

/** A filter of `text` in any column, part of a cell, the rows that match, and `rest`. */
function filter(text: string, rest: Partial<Filter> = {}): Filter {
  return { text, column: null, cell: "part", showing: "matching", ...rest };
}

/** `filter(text, rest)` for the table loaded at `loadedAt`. */
function ofLoad(text: string, loadedAt = 1, rest: Partial<Filter> = {}): FilterOfLoad {
  if (!isRevision(loadedAt)) throw new Error("not a revision");
  return { filter: filter(text, rest), loadedAt };
}

/** The filter a step sends, or `null`. */
function sent(step: FindStep): Filter | null {
  return step.send?.filter ?? null;
}

describe("the find bar's own filter", () => {
  test("is sent at once when nothing is on its way, and not when it is the backend's", () => {
    const backend = ofLoad("");
    const typed = edited(NO_DRAFT, { text: "sp" }, backend);
    expect(sent(typed)).toEqual(filter("sp"));
    expect(drawnFilter(typed.draft, backend)).toEqual(filter("sp"));
    const same = edited(NO_DRAFT, { text: "" }, backend);
    expect(sent(same)).toBeNull();
    expect(same.draft).toEqual(NO_DRAFT);
  });

  test("keeps a column chosen while a filter is on its way, and sends it next", () => {
    const empty = ofLoad("");
    const typed = edited(NO_DRAFT, { text: "sp" }, empty);
    const chosen = edited(typed.draft, { column: ORIGIN }, empty);
    expect(sent(chosen)).toBeNull();
    expect(drawnFilter(chosen.draft, empty)).toEqual(filter("sp", { column: ORIGIN }));
    // The backend's filter becomes the text sent, in any column.
    const typedHeld = ofLoad("sp");
    const heard = backendChanged(chosen.draft, typedHeld);
    expect(drawnFilter(heard, typedHeld)).toEqual(filter("sp", { column: ORIGIN }));
    const next = sendAnswered(heard, "applied", typedHeld);
    expect(sent(next)).toEqual(filter("sp", { column: ORIGIN }));
    // Once the backend holds it, the bar holds nothing of its own.
    const held = ofLoad("sp", 1, { column: ORIGIN });
    const done = sendAnswered(backendChanged(next.draft, held), "applied", held);
    expect(sent(done)).toBeNull();
    expect(done.draft).toEqual(NO_DRAFT);
  });

  test("is dropped by a load, and not sent to the table loaded", () => {
    const typed = edited(NO_DRAFT, { text: "sp" }, ofLoad(""));
    const waiting = edited(typed.draft, { text: "spa", column: ORIGIN }, ofLoad(""));
    // Another table, loaded at 5, comes with no filter.
    const loaded = ofLoad("", 5);
    const heard = backendChanged(waiting.draft, loaded);
    expect(drawnFilter(heard, loaded)).toEqual(filter(""));
    for (const outcome of ["applied", "dropped"] as const) {
      const answered = sendAnswered(heard, outcome, loaded);
      expect(sent(answered)).toBeNull();
      expect(answered.draft).toEqual(NO_DRAFT);
    }
  });

  test("typed after a load, while a send of the table before is on its way, is sent after it", () => {
    const typed = edited(NO_DRAFT, { text: "sp" }, ofLoad(""));
    const loaded = ofLoad("", 5);
    const again = edited(backendChanged(typed.draft, loaded), { text: "pe" }, loaded);
    expect(sent(again)).toBeNull();
    const answered = sendAnswered(again.draft, "dropped", loaded);
    expect(answered.send).toEqual(ofLoad("pe", 5));
  });

  test("is not taken back by a late message of an older filter", () => {
    const empty = ofLoad("");
    const first = edited(NO_DRAFT, { text: "s" }, empty);
    const more = edited(first.draft, { text: "sp" }, empty);
    const most = edited(more.draft, { text: "spa" }, empty);
    const older = ofLoad("s");
    const heard = backendChanged(most.draft, older);
    expect(drawnFilter(heard, older)).toEqual(filter("spa"));
    expect(sent(sendAnswered(heard, "applied", older))).toEqual(filter("spa"));
  });

  test("typed back to the backend's while another is on its way is sent after it", () => {
    const empty = ofLoad("");
    const typed = edited(NO_DRAFT, { text: "s" }, empty);
    const erased = edited(typed.draft, { text: "" }, empty);
    expect(drawnFilter(erased.draft, empty)).toEqual(filter(""));
    const held = ofLoad("s");
    const heard = backendChanged(erased.draft, held);
    expect(drawnFilter(heard, held)).toEqual(filter(""));
    expect(sent(sendAnswered(heard, "applied", held))).toEqual(filter(""));
  });

  test("is dropped when the send is refused, and no older filter is sent after a newer one", () => {
    const empty = ofLoad("");
    const typed = edited(NO_DRAFT, { text: "s" }, empty);
    const waiting = edited(typed.draft, { text: "sp" }, empty);
    const refused = sendAnswered(waiting.draft, "dropped", empty);
    expect(sent(refused)).toBeNull();
    expect(refused.draft).toEqual(NO_DRAFT);
    expect(drawnFilter(refused.draft, empty)).toEqual(filter(""));
    const newer = edited(refused.draft, { text: "spa" }, empty);
    expect(sent(newer)).toEqual(filter("spa"));
    expect(sent(sendAnswered(newer.draft, "applied", empty))).toBeNull();
  });

  test("is not sent again once applied, while the message of the change is on its way", () => {
    const empty = ofLoad("");
    const typed = edited(NO_DRAFT, { text: "sp" }, empty);
    const answered = sendAnswered(typed.draft, "applied", empty);
    expect(sent(answered)).toBeNull();
    expect(drawnFilter(answered.draft, empty)).toEqual(filter("sp"));
    expect(backendChanged(answered.draft, ofLoad("sp"))).toEqual(NO_DRAFT);
  });

  test("is nothing with no project open", () => {
    const typed = edited(NO_DRAFT, { text: "sp" }, ofLoad(""));
    expect(drawnFilter(typed.draft, null)).toBeNull();
    expect(backendChanged(typed.draft, null).pending).toBeNull();
    expect(sent(edited(NO_DRAFT, { text: "sp" }, null))).toBeNull();
  });
});
