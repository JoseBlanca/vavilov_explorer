import { describe, expect, test } from "vitest";

import TOKENS from "./tokens.css?raw";

/** The colour tokens declared in the block that starts with `selector`. */
function colours(selector: string): Map<string, string> {
  const start = TOKENS.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  // From the start of the selector, which may hold its own brace.
  const open = TOKENS.indexOf("{", start);
  const close = TOKENS.indexOf("}", open);
  const block = TOKENS.slice(open + 1, close);
  return new Map(
    [...block.matchAll(/(--color-[a-z-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [
      match[1] ?? "",
      match[2] ?? "",
    ]),
  );
}

/** The relative luminance of WCAG 2.2 of a colour `#rrggbb`. */
function luminance(colour: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The contrast ratio of WCAG 2.2 of two colours. */
function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].toSorted((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * The pairs of tokens the components draw together, and the least ratio
 * each needs: 4.5 for text, 3 for the parts of a control and the focus
 * ring (css.md, "Contrast and colour").
 */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["--color-text", "--color-surface", 4.5],
  ["--color-text", "--color-panel", 4.5],
  ["--color-text-muted", "--color-panel", 4.5],
  ["--color-text", "--color-selected-surface", 4.5],
  ["--color-text-muted", "--color-selected-surface", 4.5],
  ["--color-control-border", "--color-panel", 3],
  ["--color-control-border", "--color-selected-surface", 3],
  ["--color-accent", "--color-panel", 3],
  ["--color-accent", "--color-selected-surface", 3],
  ["--color-focus", "--color-panel", 3],
  ["--color-focus", "--color-surface", 3],
  ["--color-focus", "--color-selected-surface", 3],
  ["--color-danger-text", "--color-danger-surface", 4.5],
  ["--color-danger-text", "--color-selected-surface", 4.5],
  ["--color-add-text", "--color-add-surface", 4.5],
  ["--color-remove-text", "--color-remove-surface", 4.5],
  ["--color-add-surface", "--color-panel", 3],
  ["--color-remove-surface", "--color-panel", 3],
  ["--color-add-surface", "--color-selected-surface", 3],
  ["--color-remove-surface", "--color-selected-surface", 3],
  // The marks of the point views, against the surface they are drawn on.
  ["--color-point", "--color-surface", 3],
  ["--color-point-unassigned", "--color-surface", 3],
  ["--color-add-surface", "--color-surface", 3],
  ["--color-remove-surface", "--color-surface", 3],
  ["--color-text", "--color-surface", 3],
  ["--color-control-border", "--color-surface", 3],
  // The map of countries: the borders over a country of no individual, and
  // the most individuals against none. The low end of the scale differs
  // from none by its hue, and the hover's label gives its count.
  ["--color-control-border", "--color-country-empty", 3],
  ["--color-count-high", "--color-country-empty", 3],
  // The histogram: the edge of every segment against the paler grey of the
  // groups not selected, which it outlines, and the grey of the unassigned
  // against that paler grey, so that the two segments differ.
  ["--color-control-border", "--color-other-groups", 3],
  ["--color-point-unassigned", "--color-other-groups", 3],
];

describe("the tokens", () => {
  test("the two blocks of the dark appearance declare the same values", () => {
    const system = colours(':root:not([data-theme="light"])');
    const setting = colours(':root[data-theme="dark"]');
    expect(system.size).toBeGreaterThan(0);
    expect(setting).toEqual(system);
  });

  test("the light and the dark appearance declare the same colours", () => {
    expect([...colours(":root {").keys()].toSorted()).toEqual(
      [...colours(':root[data-theme="dark"]').keys()].toSorted(),
    );
  });

  for (const [appearance, selector] of [
    ["light", ":root {"],
    ["dark", ':root[data-theme="dark"]'],
  ] as const) {
    test(`every pair drawn together has its contrast, in the ${appearance} appearance`, () => {
      const tokens = colours(selector);
      const failing = PAIRS.flatMap(([foreground, background, least]) => {
        const ratio = contrast(tokens.get(foreground) ?? "", tokens.get(background) ?? "");
        return ratio >= least
          ? []
          : [`${foreground} on ${background}: ${ratio.toFixed(2)} < ${String(least)}`];
      });
      expect(failing).toEqual([]);
    });
  }
});
