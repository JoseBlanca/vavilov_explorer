// What the find bar keeps of its own: the filter the user asked for while
// the backend does not hold it yet, and the one on its way to the backend
// (docs/core.md, section 5, "The filter"). Pure functions, so that every
// order of typing, answers and messages is tested in node.

import { sameFilter } from "./filter.ts";
import type { Filter } from "./filter.ts";
import type { Revision } from "./ids.ts";

/** A filter, and the load of the table it is for. */
export interface FilterOfLoad {
  /** The filter. */
  readonly filter: Filter;
  /** The revision at which the table it is for was loaded. */
  readonly loadedAt: Revision;
}

/** The find bar's own state. */
export interface FindDraft {
  /**
   * The whole filter the user asked for last, and the load it was made for,
   * while the backend's filter is not yet that one; `null` once it is, or
   * once it can no longer be.
   */
  readonly pending: FilterOfLoad | null;
  /** The filter of the one `set_filter` on its way to the backend, or `null`. */
  readonly sending: FilterOfLoad | null;
}

/** A step of the find bar: its state after it, and the filter to send now, or `null`. */
export interface FindStep {
  /** The find bar's state after the step. */
  readonly draft: FindDraft;
  /** The filter to send to the backend now; it is the draft's `sending`. */
  readonly send: FilterOfLoad | null;
}

/** The state of a find bar that holds nothing of its own. */
export const NO_DRAFT: FindDraft = { pending: null, sending: null };

/** Whether `one` is the same filter as `other`, for the same load. */
function sameOfLoad(one: FilterOfLoad, other: FilterOfLoad): boolean {
  return one.loadedAt === other.loadedAt && sameFilter(one.filter, other.filter);
}

/**
 * The draft with its pending filter dropped when it can no longer be sent,
 * the table having been closed or another loaded, or when the backend holds
 * it and the send on its way, if any, sends that same filter.
 */
function settled(draft: FindDraft, backend: FilterOfLoad | null): FindDraft {
  const { pending, sending } = draft;
  if (pending === null) {
    return draft;
  }
  if (pending.loadedAt !== backend?.loadedAt) {
    return { pending: null, sending };
  }
  const held = sameOfLoad(pending, backend);
  const sendsIt = sending === null || sameOfLoad(sending, pending);
  return held && sendsIt ? { pending: null, sending } : draft;
}

/** The draft, with its pending filter sent when nothing else is on its way. */
function sendingNext(draft: FindDraft): FindStep {
  if (draft.sending !== null || draft.pending === null) {
    return { draft, send: null };
  }
  return { draft: { pending: draft.pending, sending: draft.pending }, send: draft.pending };
}

/**
 * The filter the bar draws: the one the user asked for while it is pending
 * for the table loaded, else the backend's; `null` with no project, for
 * `backend` `null`.
 */
export function drawnFilter(draft: FindDraft, backend: FilterOfLoad | null): Filter | null {
  if (backend === null) {
    return null;
  }
  const { pending } = draft;
  return pending !== null && pending.loadedAt === backend.loadedAt
    ? pending.filter
    : backend.filter;
}

/**
 * The user changed the filter: `change` over the filter drawn becomes the
 * pending filter, sent at once when no other is on its way, and dropped
 * when it is the backend's and nothing else is on its way.
 */
export function edited(
  draft: FindDraft,
  change: Partial<Filter>,
  backend: FilterOfLoad | null,
): FindStep {
  const drawn = drawnFilter(draft, backend);
  if (backend === null || drawn === null) {
    return { draft: { pending: null, sending: draft.sending }, send: null };
  }
  const pending = { filter: { ...drawn, ...change }, loadedAt: backend.loadedAt };
  return sendingNext(settled({ pending, sending: draft.sending }, backend));
}

/**
 * The window's copy of the backend's filter changed, or the table loaded: a
 * pending filter the backend now holds, or of a table no longer loaded, is
 * dropped. An older filter the backend held meanwhile does not replace the
 * pending one, which is sent once the send on its way is answered.
 */
export function backendChanged(draft: FindDraft, backend: FilterOfLoad | null): FindDraft {
  return settled(draft, backend);
}

/**
 * The filter on its way was answered: `applied`, or `dropped` when it was
 * stale, refused or failed. A pending filter is sent next, unless it is the
 * one just applied, whose message is on its way. A dropped send drops the
 * pending filter of its load too, so that no filter older than the one the
 * user sees is sent after a newer; one of a table loaded since is sent.
 */
export function sendAnswered(
  draft: FindDraft,
  outcome: "applied" | "dropped",
  backend: FilterOfLoad | null,
): FindStep {
  const { pending, sending } = draft;
  const answered: FindDraft =
    outcome === "dropped" && pending !== null && pending.loadedAt === sending?.loadedAt
      ? NO_DRAFT
      : settled({ pending, sending: null }, backend);
  if (
    outcome === "applied" &&
    answered.pending !== null &&
    sending !== null &&
    sameOfLoad(answered.pending, sending)
  ) {
    return { draft: answered, send: null };
  }
  return sendingNext(answered);
}
