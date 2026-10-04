// The decoder of a message of the kind action, an item of the menu the
// app layer hands to the main window (src-tauri/src/actions.rs): the
// header, then one part of 8 bytes with the item's code and six zeros.

import { defect } from "../state/defect.ts";
import { MENU_ACTIONS } from "../state/transfer.ts";
import type { MenuAction } from "../state/transfer.ts";
import { expectLength, expectZeros, readMessage } from "./layout.ts";

/** The kind of a message of an action, its byte 0. */
const ACTION_MESSAGE = 4;
/** The kind of its part. */
const ACTION_PART = 12;

/** Whether `bytes` is a message of the kind action, by its byte 0. */
export function isActionMessage(bytes: ArrayBuffer): boolean {
  return bytes.byteLength > 0 && new DataView(bytes).getUint8(0) === ACTION_MESSAGE;
}

/**
 * The item of the menu of a message of the kind action.
 *
 * @throws A defect when the bytes are not such a message.
 */
export function decodeAction(bytes: ArrayBuffer): MenuAction {
  const view = new DataView(bytes);
  const { header, parts } = readMessage(bytes, view);
  const [part, ...rest] = parts;
  if (header.kind !== ACTION_MESSAGE || part?.kind !== ACTION_PART || rest.length > 0) {
    throw defect(`a message of kind ${String(header.kind)} that is not one action part`);
  }
  expectLength("action", part.length, 8);
  expectZeros(view, part.start + 2, part.start + 8, "bytes 2 to 7 of an action part");
  const code = view.getUint16(part.start, true);
  const action = MENU_ACTIONS[code - 1];
  if (action === undefined) {
    throw defect(`an action of code ${String(code)}`);
  }
  return action;
}
