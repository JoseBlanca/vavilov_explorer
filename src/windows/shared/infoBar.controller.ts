import { nothing, render } from "lit-html";

import {
  NO_MESSAGES,
  isDismissable,
  kindWords,
  nextChangeAt,
  waitingWords,
  withMessage,
  withShownDismissed,
  withTimePassed,
} from "../../state/barMessages.ts";
import type { BarMessage, BarMessages } from "../../state/barMessages.ts";
import type { Aspect, WindowState } from "../../state/windowState.ts";
import { countText } from "./numbers.ts";
import { infoBarView } from "./infoBar.view.ts";
import type { InfoBarMessage } from "./infoBar.view.ts";

/** The information bar in its element. */
export interface InfoBar {
  /** Shows `message`, or puts it in the queue behind the one shown. */
  readonly tell: (message: BarMessage) => void;
  /** Takes away the message shown and those waiting. */
  readonly clear: () => void;
  /** Draws the count again, when it changed other than with its aspects. */
  readonly recount: () => void;
  /** Unsubscribes, stops its timers, and empties the element. */
  readonly destroy: () => void;
}

/** The count the bar shows after its message: what the window counts. */
export interface InfoCount {
  /** The aspects of the window's copy the count is drawn from. */
  readonly aspects: readonly Aspect[];
  /** The count in words, or `null` when there is none, as with no project open. */
  readonly text: () => string | null;
}

/**
 * How long the count must stay the same before a screen reader is told it,
 * in milliseconds: a pause in typing, so that the count of each key typed
 * in the find bar is not read out.
 */
const ANNOUNCE_AFTER_MS = 500;

/**
 * The information bar at the bottom of a window: the message shown, of
 * those the window tells it, one at a time (src/state/barMessages.ts); and
 * the window's `count`, the rows of the table in the main window, the
 * individuals drawn in a plot window, drawn again when any of its aspects
 * changes, and told to a screen reader once it has not changed for
 * {@link ANNOUNCE_AFTER_MS}. When the user dismisses a message, the focus goes to the × of the
 * next, when it has one, and otherwise back to where it was when the bar
 * first showed a message with its ×, or, when that is no longer in the
 * window, to `refocus`.
 */
export function createInfoBar(
  element: HTMLElement,
  state: WindowState,
  count: InfoCount,
  refocus: () => void,
): InfoBar {
  /** The count told to a screen reader. */
  let announced = "";
  /** The count waiting to be told, and its timer. */
  let waiting: { readonly count: string; readonly timer: number } | null = null;
  let messages: BarMessages = NO_MESSAGES;
  /** The timer after which an informational message gives way, if one does. */
  let messageTimer: number | null = null;
  /** Where the focus goes back to once no message with its × is shown. */
  let focusBefore: Element | null = null;

  const stopWaiting = (): void => {
    if (waiting !== null) {
      clearTimeout(waiting.timer);
      waiting = null;
    }
  };

  const shownMessage = (): InfoBarMessage | null => {
    const shown = messages.shown?.message ?? null;
    return shown === null
      ? null
      : {
          kind: shown.kind,
          kindWords: kindWords(shown.kind),
          text: shown.text,
          waiting: waitingWords(messages, countText),
          dismissable: isDismissable(shown.kind),
        };
  };

  /** Whether the message shown has its ×. */
  const showsDismissable = (): boolean =>
    messages.shown !== null && isDismissable(messages.shown.message.kind);

  /** Takes `next` as the messages, keeps the timer of the next change, and draws. */
  const change = (next: BarMessages): void => {
    const nextDismissable = next.shown !== null && isDismissable(next.shown.message.kind);
    if (!nextDismissable) {
      focusBefore = null;
    } else if (!showsDismissable()) {
      focusBefore = document.activeElement;
    }
    messages = next;
    if (messageTimer !== null) {
      clearTimeout(messageTimer);
      messageTimer = null;
    }
    const at = nextChangeAt(messages);
    if (at !== null) {
      messageTimer = window.setTimeout(
        () => {
          messageTimer = null;
          change(withTimePassed(messages, performance.now()));
        },
        Math.max(0, at - performance.now()),
      );
    }
    draw();
  };

  const dismiss = (): void => {
    const focus = focusBefore;
    change(withShownDismissed(messages, performance.now()));
    if (showsDismissable()) {
      const next = element.querySelector("[data-dismiss]");
      if (next instanceof HTMLElement) {
        next.focus();
      }
      return;
    }
    if (focus instanceof HTMLElement && focus !== document.body && focus.isConnected) {
      focus.focus();
    } else {
      refocus();
    }
  };

  const draw = (): void => {
    const counted = count.text();
    if (counted === null) {
      stopWaiting();
      announced = "";
    } else {
      if (counted === announced) {
        stopWaiting();
      } else if (waiting?.count !== counted) {
        stopWaiting();
        const told = counted;
        waiting = {
          count: told,
          timer: window.setTimeout(() => {
            waiting = null;
            announced = told;
            draw();
          }, ANNOUNCE_AFTER_MS),
        };
      }
    }
    render(
      infoBarView({ message: shownMessage(), count: counted, announced, onDismiss: dismiss }),
      element,
    );
  };
  const unsubscribes = count.aspects.map((aspect) => state.subscribe(aspect, draw));
  draw();
  return {
    tell: (message) => {
      change(withMessage(messages, message, performance.now()));
    },
    clear: () => {
      change(NO_MESSAGES);
    },
    recount: draw,
    destroy: () => {
      stopWaiting();
      if (messageTimer !== null) {
        clearTimeout(messageTimer);
        messageTimer = null;
      }
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      render(nothing, element);
    },
  };
}
