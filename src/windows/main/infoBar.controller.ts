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
import type { WindowState } from "../../state/windowState.ts";
import { tableCountOf, tableCountText } from "../../state/tableCount.ts";
import { countText } from "../shared/numbers.ts";
import { infoBarView } from "./infoBar.view.ts";
import type { InfoBarMessage } from "./infoBar.view.ts";

/** The information bar in its element. */
export interface InfoBar {
  /** Shows `message`, or puts it in the queue behind the one shown. */
  readonly tell: (message: BarMessage) => void;
  /** Takes away the message shown and those waiting. */
  readonly clear: () => void;
  /** Unsubscribes, stops its timers, and empties the element. */
  readonly destroy: () => void;
}

/**
 * How long the count must stay the same before a screen reader is told it,
 * in milliseconds: a pause in typing, so that the count of each key typed
 * in the find bar is not read out.
 */
const ANNOUNCE_AFTER_MS = 500;

/**
 * The information bar below the table: the message shown, of those the
 * window tells it, one at a time (src/state/barMessages.ts); and the count
 * of the rows the filter shows, of the table and of the selection, drawn
 * again when any of them changes, and told to a screen reader once it has
 * not changed for {@link ANNOUNCE_AFTER_MS}, with no count with no project
 * open. When the user dismisses a message, the focus goes to the × of the
 * next, when it has one, and otherwise back to where it was when the bar
 * first showed a message with its ×, or, when that is no longer in the
 * window, to `refocus`.
 */
export function createInfoBar(
  element: HTMLElement,
  state: WindowState,
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
    const table = tableCountOf(state.project(), state.shown(), state.selection());
    let count: string | null = null;
    if (table === null) {
      stopWaiting();
      announced = "";
    } else {
      count = tableCountText(table, countText);
      if (count === announced) {
        stopWaiting();
      } else if (waiting?.count !== count) {
        stopWaiting();
        const told = count;
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
    render(infoBarView({ message: shownMessage(), count, announced, onDismiss: dismiss }), element);
  };
  const unsubscribes = (["table", "filter", "selection"] as const).map((aspect) =>
    state.subscribe(aspect, draw),
  );
  draw();
  return {
    tell: (message) => {
      change(withMessage(messages, message, performance.now()));
    },
    clear: () => {
      change(NO_MESSAGES);
    },
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
