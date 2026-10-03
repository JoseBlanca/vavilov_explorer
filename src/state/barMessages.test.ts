import { describe, expect, test } from "vitest";

import {
  WARNING_SHOWN_MS,
  isDismissable,
  kindWords,
  NO_MESSAGES,
  waitingWords,
  nextChangeAt,
  withMessage,
  withShownDismissed,
  withTimePassed,
} from "./barMessages.ts";
import type { BarMessage, BarMessages } from "./barMessages.ts";

const refused: BarMessage = { kind: "error", text: "“a.csv” was not imported. Its first column…" };
const notExported: BarMessage = { kind: "error", text: "The table was not exported. The value…" };
const undecoded: BarMessage = { kind: "warning", text: "“b.csv” was imported, but line 3…" };
const written: BarMessage = { kind: "information", text: "“table.csv” was written." };
const copied: BarMessage = { kind: "information", text: "The rows were copied." };

/** `messages` added one after the other, each at its time. */
function added(...steps: readonly (readonly [BarMessage, number])[]): BarMessages {
  return steps.reduce(
    (messages, [message, now]) => withMessage(messages, message, now),
    NO_MESSAGES,
  );
}

describe("a message added", () => {
  test("is shown at once when nothing is", () => {
    for (const message of [refused, undecoded, written]) {
      expect(added([message, 100])).toEqual({ shown: { message, since: 100 }, waiting: [] });
    }
  });

  test("of an error or a warning waits behind an error or a warning, in the order they came", () => {
    expect(added([refused, 0], [undecoded, 10], [notExported, 20])).toEqual({
      shown: { message: refused, since: 0 },
      waiting: [undecoded, notExported],
    });
    expect(added([undecoded, 0], [refused, 10])).toEqual({
      shown: { message: undecoded, since: 0 },
      waiting: [refused],
    });
  });

  test("of an error or a warning replaces an informational message at once", () => {
    expect(added([written, 0], [refused, 1])).toEqual({
      shown: { message: refused, since: 1 },
      waiting: [],
    });
    expect(added([written, 0], [undecoded, 1])).toEqual({
      shown: { message: undecoded, since: 1 },
      waiting: [],
    });
  });

  test("informational replaces an informational one at once", () => {
    expect(added([written, 0], [copied, 1])).toEqual({
      shown: { message: copied, since: 1 },
      waiting: [],
    });
  });

  test("informational, while an error or a warning is shown, is dropped and never waits", () => {
    const messages = added([refused, 0], [undecoded, 10]);
    expect(withMessage(messages, written, 20)).toEqual(messages);
    expect(withMessage(added([undecoded, 0]), written, 20)).toEqual(added([undecoded, 0]));
  });

  test("with the words of one shown or waiting is not added again", () => {
    const messages = added([refused, 0], [undecoded, 10]);
    expect(withMessage(messages, refused, 20)).toEqual(messages);
    expect(withMessage(messages, undecoded, 30)).toEqual(messages);
    expect(withMessage(messages, { kind: "warning", text: refused.text }, 40)).toEqual({
      shown: { message: refused, since: 0 },
      waiting: [undecoded, { kind: "warning", text: refused.text }],
    });
  });
});

describe("the time a message is shown", () => {
  test("of an error lasts until it is dismissed", () => {
    const messages = added([refused, 0], [undecoded, 10]);
    expect(nextChangeAt(messages)).toBeNull();
    expect(withTimePassed(messages, 1_000_000)).toEqual(messages);
  });

  test("of a warning ends after its time, and the next waiting shows", () => {
    const messages = added([undecoded, 1000], [refused, 2000]);
    expect(nextChangeAt(messages)).toBe(1000 + WARNING_SHOWN_MS);
    expect(withTimePassed(messages, 1000 + WARNING_SHOWN_MS - 1)).toEqual(messages);
    expect(withTimePassed(messages, 1000 + WARNING_SHOWN_MS)).toEqual({
      shown: { message: refused, since: 1000 + WARNING_SHOWN_MS },
      waiting: [],
    });
  });

  test("of a warning with nothing behind it ends, and the bar is empty", () => {
    const messages = added([undecoded, 0]);
    expect(nextChangeAt(messages)).toBe(WARNING_SHOWN_MS);
    expect(withTimePassed(messages, WARNING_SHOWN_MS)).toEqual(NO_MESSAGES);
  });

  test("of a warning shown after an error counts from when it shows", () => {
    const messages = withShownDismissed(added([refused, 0], [undecoded, 10]), 9000);
    expect(messages).toEqual({ shown: { message: undecoded, since: 9000 }, waiting: [] });
    expect(nextChangeAt(messages)).toBe(9000 + WARNING_SHOWN_MS);
  });

  test("of an informational message lasts until another message replaces it", () => {
    const messages = added([written, 0]);
    expect(nextChangeAt(messages)).toBeNull();
    expect(withTimePassed(messages, 1_000_000)).toEqual(messages);
  });
});

describe("a message dismissed", () => {
  test("shows the next waiting, from then", () => {
    const messages = added([refused, 0], [notExported, 10], [undecoded, 20]);
    expect(withShownDismissed(messages, 500)).toEqual({
      shown: { message: notExported, since: 500 },
      waiting: [undecoded],
    });
  });

  test("leaves the bar empty when nothing waits", () => {
    expect(withShownDismissed(added([refused, 0]), 500)).toEqual(NO_MESSAGES);
  });

  test("is an error's alone: a warning or an informational one has no ×", () => {
    expect([
      isDismissable("error"),
      isDismissable("warning"),
      isDismissable("information"),
    ]).toEqual([true, false, false]);
    expect(() => withShownDismissed(added([undecoded, 0]), 10)).toThrow(/Vavilov Explorer defect/);
    expect(() => withShownDismissed(added([written, 0]), 10)).toThrow(/Vavilov Explorer defect/);
    expect(() => withShownDismissed(NO_MESSAGES, 10)).toThrow(/Vavilov Explorer defect/);
  });
});

describe("the words of the bar", () => {
  test("name each kind", () => {
    expect([kindWords("error"), kindWords("warning"), kindWords("information")]).toEqual([
      "Error",
      "Warning",
      "Information",
    ]);
  });

  test("say how many messages wait, in the user's language, and nothing when none does", () => {
    const spanish = (value: number): string =>
      new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(value);
    expect(waitingWords(added([refused, 0]), spanish)).toBe("");
    expect(waitingWords(added([refused, 0], [undecoded, 1]), spanish)).toBe("(1 more)");
    const many = Array.from({ length: 1201 }, (_, index): readonly [BarMessage, number] => [
      { kind: "error", text: String(index) },
      index,
    ]);
    expect(waitingWords(added(...many), spanish)).toBe("(1.200 more)");
  });
});
