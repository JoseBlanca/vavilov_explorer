// The messages of the information bar, one shown at a time and the errors
// and warnings waiting behind it (docs/design.md, section 2.1). Pure: the time is given
// by the caller, in milliseconds of one clock.

import { defect } from "./defect.ts";

/** The kinds of message, as the bar names them in words. */
export type MessageKind = "error" | "warning" | "information";

/** A message of the bar: its kind, and its words, written for the user. */
export interface BarMessage {
  /**
   * Its kind: an error stays until it is dismissed with ×, a warning for
   * {@link WARNING_SHOWN_MS}, and an informational message until another
   * message takes its place.
   */
  readonly kind: MessageKind;
  /** What happened and how to put it right, in full sentences. */
  readonly text: string;
}

/** The message the bar shows, and since when. */
export interface ShownMessage {
  /** The message. */
  readonly message: BarMessage;
  /** When it was first shown, in milliseconds of the caller's clock. */
  readonly since: number;
}

/** The messages of the bar: the one shown, and the errors and warnings waiting, the next first. */
export interface BarMessages {
  /** The message shown, or `null` for none, when nothing waits either. */
  readonly shown: ShownMessage | null;
  /** The errors and warnings waiting, in the order they came. */
  readonly waiting: readonly BarMessage[];
}

/** No message shown and none waiting. */
export const NO_MESSAGES: BarMessages = { shown: null, waiting: [] };

/** How long a warning is shown, in milliseconds: 5 seconds, decided by the owner on 3 October 2026. */
export const WARNING_SHOWN_MS = 5000;

/** Whether a message of `kind` stays until it is dismissed with ×: an error alone. */
export function isDismissable(kind: MessageKind): boolean {
  switch (kind) {
    case "error":
      return true;
    case "warning":
    case "information":
      return false;
  }
}

/**
 * `messages` with `message` added at `now` (docs/design.md, section 2.1).
 * An informational message is shown at once in the place of nothing or of
 * another informational one, and is dropped while an error or a warning is
 * shown: it never waits. An error or a warning is shown at once in the
 * place of nothing or of an informational message, and otherwise waits,
 * last; one with the kind and the words of one shown or waiting is not
 * added again.
 */
export function withMessage(messages: BarMessages, message: BarMessage, now: number): BarMessages {
  const { shown, waiting } = messages;
  const fresh = { shown: { message, since: now }, waiting };
  if (message.kind === "information") {
    return shown === null || shown.message.kind === "information" ? fresh : messages;
  }
  const same = (other: BarMessage): boolean =>
    other.kind === message.kind && other.text === message.text;
  if ((shown !== null && same(shown.message)) || waiting.some(same)) {
    return messages;
  }
  if (shown === null || shown.message.kind === "information") {
    return fresh;
  }
  return { shown, waiting: [...waiting, message] };
}

/** `waiting` with its first message shown from `now`, or nothing shown when none waits. */
function nextShown(waiting: readonly BarMessage[], now: number): BarMessages {
  const [next, ...rest] = waiting;
  return next === undefined ? NO_MESSAGES : { shown: { message: next, since: now }, waiting: rest };
}

/**
 * `messages` after the user dismissed the error shown, at `now`: the next
 * waiting is shown, or none.
 *
 * @throws A defect when the message shown is not an error, or there is
 * none, since only an error has its ×.
 */
export function withShownDismissed(messages: BarMessages, now: number): BarMessages {
  if (messages.shown === null || !isDismissable(messages.shown.message.kind)) {
    throw defect("a message dismissed where none has its ×");
  }
  return nextShown(messages.waiting, now);
}

/**
 * `messages` at `now`: a warning shown for {@link WARNING_SHOWN_MS} gives
 * way to the next waiting, or to nothing; otherwise they are unchanged.
 */
export function withTimePassed(messages: BarMessages, now: number): BarMessages {
  const at = nextChangeAt(messages);
  return at !== null && now >= at ? nextShown(messages.waiting, now) : messages;
}

/**
 * When the message shown goes by itself, in milliseconds of the caller's
 * clock: when a warning's time ends; `null` for an error or an
 * informational message, which only the user or a new message changes.
 */
export function nextChangeAt(messages: BarMessages): number | null {
  const { shown } = messages;
  return shown?.message.kind === "warning" ? shown.since + WARNING_SHOWN_MS : null;
}

/** The kind of a message in words, as the bar writes it before the message. */
export function kindWords(kind: MessageKind): string {
  switch (kind) {
    case "error":
      return "Error";
    case "warning":
      return "Warning";
    case "information":
      return "Information";
  }
}

/**
 * The words after the message shown that say how many wait behind it, "(2
 * more)", with `count` writing the number in the user's language; empty
 * when none waits.
 */
export function waitingWords(messages: BarMessages, count: (value: number) => string): string {
  return messages.waiting.length === 0 ? "" : `(${count(messages.waiting.length)} more)`;
}
