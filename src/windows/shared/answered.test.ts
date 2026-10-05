import { describe, expect, test } from "vitest";

import type { Answer } from "../../backend/connection.ts";
import type { BarMessage } from "../../state/barMessages.ts";
import { answered } from "./answered.ts";

/** What `answered` did with `answer`: the draws, the messages told and the defects reported. */
function outcome(
  answer: Answer,
  withWords: boolean,
): {
  draws: number;
  told: BarMessage[];
  reported: string[];
} {
  let draws = 0;
  const told: BarMessage[] = [];
  const reported: string[] = [];
  answered(
    "undoing",
    () => {
      draws += 1;
    },
    (error) => {
      reported.push(error instanceof Error ? error.message : String(error));
    },
    withWords
      ? { action: { kind: "undo" }, tell: (message) => told.push(message), columnName: () => null }
      : null,
  )(answer);
  return { draws, told, reported };
}

describe("the answer of a command", () => {
  test("applied, does nothing", () => {
    expect(outcome({ ok: true, value: "applied" }, true)).toEqual({
      draws: 0,
      told: [],
      reported: [],
    });
  });

  test("stale, draws again and says nothing", () => {
    expect(outcome({ ok: true, value: "stale" }, true)).toEqual({
      draws: 1,
      told: [],
      reported: [],
    });
  });

  test("refused for a reason another window can cause, draws again and tells why", () => {
    expect(outcome({ ok: false, error: { kind: "nothingToUndo" } }, true)).toEqual({
      draws: 1,
      told: [{ kind: "warning", text: "There is nothing to undo." }],
      reported: [],
    });
  });

  test("refused for a reason only a defect could cause, reports the defect", () => {
    for (const withWords of [true, false]) {
      const { told, reported } = outcome(
        { ok: false, error: { kind: "rowSetLength", numRows: 6, numBytes: 2 } },
        withWords,
      );
      expect(told).toEqual([]);
      expect(reported).toEqual([
        'Vavilov Explorer defect: undoing was refused: {"kind":"rowSetLength","numRows":6,"numBytes":2}',
      ]);
    }
  });
});
