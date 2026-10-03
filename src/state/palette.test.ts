import { describe, expect, test } from "vitest";

import { PALETTE } from "./palette.ts";
// The colours the core's test compares its list with
// (crates/vavilov-core/src/table/colour/tests.rs).
import SHARED from "../../crates/vavilov-core/src/table/palette.json?raw";

describe("the list of colours of a group", () => {
  test("is the core's, in its order", () => {
    const shared: unknown = JSON.parse(SHARED);
    expect(PALETTE.map((entry) => entry.colour)).toEqual(shared);
  });

  test("names each colour by its hue and shade", () => {
    expect(PALETTE.map((entry) => entry.name)).toEqual([
      "Orange",
      "Sky blue",
      "Bluish green",
      "Yellow",
      "Blue",
      "Vermillion",
      "Reddish purple",
      "Light orange",
      "Light sky blue",
      "Light bluish green",
      "Light yellow",
      "Light blue",
      "Light vermillion",
      "Light reddish purple",
      "Dark orange",
      "Dark sky blue",
      "Dark bluish green",
      "Dark yellow",
      "Dark blue",
      "Dark vermillion",
      "Dark reddish purple",
    ]);
  });
});
