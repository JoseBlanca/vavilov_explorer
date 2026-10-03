// An element of an array that the code knows is there
// (.claude/skills/coding/typescript.md, "The compiler").

import { defect } from "./defect.ts";

/**
 * The element `index` of `values`, which the caller made sure is there, by
 * a length it checked or the way it built the array: a missing one is a
 * defect, never a value that looks like data.
 *
 * @throws A defect when `values` has no element `index`.
 */
export function at<T>(values: ArrayLike<T>, index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw defect(`no element ${String(index)} in an array of ${String(values.length)}`);
  }
  return value;
}
