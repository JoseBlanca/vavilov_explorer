import { describe, expect, test } from "vitest";

import { isCount, isText, oneOf, taggedDecoder } from "./tagged.ts";

const isSize = oneOf(["small", "large"]);

/** Two kinds: one with no field, one with a count, a text and a size. */
const isShape = taggedDecoder({
  empty: {},
  box: { width: isCount, label: isText, size: isSize },
  // A kind whose field is itself tagged.
  wrapped: { inner: taggedDecoder({ empty: {} }) },
});

describe("a decoder of tagged values", () => {
  test("takes each kind with exactly its fields, each of its type", () => {
    expect(isShape({ kind: "empty" })).toBe(true);
    expect(isShape({ kind: "box", width: 3, label: "a", size: "large" })).toBe(true);
    expect(isShape({ kind: "wrapped", inner: { kind: "empty" } })).toBe(true);
  });

  test("refuses a field missing, one more, or one of another type", () => {
    expect(isShape({ kind: "box", width: 3, label: "a" })).toBe(false);
    expect(isShape({ kind: "box", width: 3, label: "a", size: "large", depth: 1 })).toBe(false);
    expect(isShape({ kind: "empty", width: 3 })).toBe(false);
    expect(isShape({ kind: "box", width: -1, label: "a", size: "large" })).toBe(false);
    expect(isShape({ kind: "box", width: 1.5, label: "a", size: "large" })).toBe(false);
    expect(isShape({ kind: "box", width: 3, label: 3, size: "large" })).toBe(false);
    expect(isShape({ kind: "box", width: 3, label: "a", size: "huge" })).toBe(false);
    expect(isShape({ kind: "wrapped", inner: { kind: "box" } })).toBe(false);
  });

  test("refuses a kind it does not have, one inherited by every object, and what is no object", () => {
    expect(isShape({ kind: "circle" })).toBe(false);
    expect(isShape({ kind: "toString" })).toBe(false);
    expect(isShape({ kind: "box", constructor: 1, label: "a", size: "large" })).toBe(false);
    expect(isShape({ kind: 1 })).toBe(false);
    expect(isShape({})).toBe(false);
    expect(isShape(null)).toBe(false);
    expect(isShape("empty")).toBe(false);
  });
});
