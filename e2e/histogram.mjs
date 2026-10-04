// The window of the histogram against the real core, in each engine.
// Plot > Histogram… asks for a column of numbers, starting from the first
// plain number, and opens its histogram: 20 bins, the bars stacked by the
// groups of the active classification, the groups selected at the bottom
// and the others in one grey segment above them, the individuals selected
// outlined. A click on a segment selects its individuals, Cmd-click or
// Ctrl-click adds them or takes them away, and Shift-click selects a run
// of bins. The groups panel has + and − but no Add, Edit or Delete group.
// A change of role that leaves the column no number closes the window, and
// with no column of numbers the main window says so.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

/**
 * Six plants: 1 origin, a category, active, Spain (0), Peru (1) and p4
 * unassigned; 2 lat, a latitude; 3 height, from 1 to 3, missing for p5.
 * With 20 bins of 0.1, p1 is in bin 0, p2 in bin 2, p3 in bin 10, and p4
 * and p6 in bin 19. With no group selected, the segments are, in order:
 * 0 Spain (p1), 1 Peru (p2), 2 Spain (p3), 3 Peru (p6), 4 unassigned (p4).
 */
const PLANTS = {
  header: "IndividualID",
  names: ["p1", "p2", "p3", "p4", "p5", "p6"],
  columns: [
    {
      name: "origin",
      levels: [
        ["Spain", [230, 159, 0]],
        ["Peru", [86, 180, 233]],
      ],
      codes: [0, 1, 0, null, 1, 1],
    },
    { name: "lat", numeric: [40, 41, 42, 43, 44, 45], role: "latitude" },
    { name: "height", numeric: [1, 1.26, 2.04, 3, null, 3] },
  ],
  activeClassification: 1,
};

/** Two plants with no column of numbers. */
const NO_NUMBERS = {
  header: "IndividualID",
  names: ["p1", "p2"],
  columns: [{ name: "note", text: ["tall", "short"] }],
  activeClassification: null,
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true, viewport: { width: 1000, height: 520 } });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    const grid = page.getByRole("grid", { name: "Individuals" });
    await grid.getByRole("combobox", { name: "Role of height", exact: true }).waitFor();
    const choose = async (action) => {
      const sent = await backend.send({ command: "e2e:action", action });
      assert.equal(sent.ok, null, JSON.stringify(sent));
    };

    // Histogram… offers the columns of numbers, a latitude among them, and
    // starts from the first plain number.
    await choose("histogram");
    const dialog = page.getByRole("dialog", { name: "Histogram" });
    await dialog.waitFor();
    const field = dialog.getByRole("combobox", { name: "Column" });
    assert.deepEqual(await field.locator("option").allTextContents(), ["lat", "height"]);
    assert.equal(await field.locator("option:checked").textContent(), "height");
    await shoot(page, engine, "histogram-dialog");
    await dialog.getByRole("button", { name: "Open" }).click();
    const histogram = await app.window("histogram-1");
    await histogram.setViewportSize({ width: 1000, height: 640 });
    await histogram.waitForFunction(() => globalThis.document.title === "Histogram of height");
    await histogram.getByRole("img", { name: "Histogram of height" }).waitFor();
    const status = histogram.getByRole("status");
    await waitForText(status, "Drawing 5 of 6 individuals: 1 has no value.");

    // Every group in its colour, the unassigned in grey, bin by bin.
    assert.deepEqual(await fills(histogram), [
      "rgb(230, 159, 0)",
      "rgb(86, 180, 233)",
      "rgb(230, 159, 0)",
      "rgb(86, 180, 233)",
      await tokenColour(histogram, "--color-point-unassigned"),
    ]);

    // The pointer over a segment names it, its individuals and its bin.
    await hover(histogram, 3);
    await waitForText(label(histogram), "Peru: 1 individual, 2.9 to 3");
    await shoot(histogram, engine, "histogram-label");

    // A click selects a segment's individuals alone, a Cmd-click or a
    // Ctrl-click adds another's and takes them away again, and a
    // Shift-click selects a run of bins of the same group.
    // The histogram decides a click from its own copy of the selection,
    // so each click waits for the outlines to show what the histogram has:
    // the main window's table can show a change first.
    await clickSegment(histogram, 0);
    await selectedAre(page, ["p1"]);
    await outlinedAre(histogram, [0]);
    // A second click on a segment that is the whole selection selects none.
    await clickSegment(histogram, 0);
    await selectedAre(page, []);
    await outlinedAre(histogram, []);
    await clickSegment(histogram, 0);
    await selectedAre(page, ["p1"]);
    await outlinedAre(histogram, [0]);
    await clickSegment(histogram, 2, "ControlOrMeta");
    await selectedAre(page, ["p1", "p3"]);
    await outlinedAre(histogram, [0, 2]);
    await clickSegment(histogram, 2, "ControlOrMeta");
    await selectedAre(page, ["p1"]);
    await outlinedAre(histogram, [0]);
    await clickSegment(histogram, 4);
    await selectedAre(page, ["p4"]);
    await outlinedAre(histogram, [4]);
    await clickSegment(histogram, 0);
    await selectedAre(page, ["p1"]);
    await outlinedAre(histogram, [0]);
    await clickSegment(histogram, 2, "Shift");
    await selectedAre(page, ["p1", "p3"]);
    // The individuals selected are outlined, in each segment that holds one.
    await histogram.waitForFunction(
      () => globalThis.document.querySelectorAll(".plot-histogram-outline").length === 2,
    );
    await shoot(histogram, engine, "histogram-selected");

    // The groups panel has + and − on the group selected, and no Add,
    // Edit or Delete group.
    const panel = histogram.getByRole("region", { name: "Groups" });
    await panel.getByRole("button", { name: /^Peru/ }).click();
    await panel.getByRole("button", { name: "Remove selected from Peru" }).waitFor();
    for (const name of ["Add group", /^Edit group/, /^Delete group/]) {
      assert.equal(await panel.getByRole("button", { name }).count(), 0, String(name));
    }
    // With Peru selected, its individuals are at the bottom of each bar,
    // and every other individual in one grey segment above them: 0 others
    // (p1), 1 Peru (p2), 2 others (p3), 3 Peru (p6), 4 others (p4).
    const grey = await tokenColour(histogram, "--color-point-unassigned");
    await histogram.waitForFunction(
      () => globalThis.document.querySelectorAll("[data-segment]").length === 5,
    );
    assert.deepEqual(await fills(histogram), [
      grey,
      "rgb(86, 180, 233)",
      grey,
      "rgb(86, 180, 233)",
      grey,
    ]);
    await hover(histogram, 4);
    await waitForText(label(histogram), "Other groups: 1 individual, 2.9 to 3");
    await shoot(histogram, engine, "histogram-groups");
    // A click on the grey segment selects the individuals of the other
    // groups in its bin.
    await clickSegment(histogram, 0);
    await selectedAre(page, ["p1"]);

    // While + is pressed, a click on a segment puts its individuals in the
    // group: p3, of Spain, goes to Peru.
    await panel.getByRole("button", { name: "Add selected to Peru", exact: true }).click();
    await panel.getByRole("button", { name: "Add selected to Peru", pressed: true }).waitFor();
    await clickSegment(histogram, 2);
    await originSays(grid, "p3", "Peru");
    // A click on the grey segment of the last bin puts p4 in Peru too: the
    // bar under the pointer, which has not moved, is Peru's alone now, and
    // the label names it, not a segment that moved into its place.
    await clickSegment(histogram, 4);
    await originSays(grid, "p4", "Peru");
    await waitForText(label(histogram), "Peru: 2 individuals, 2.9 to 3");
    await histogram.keyboard.press("Escape");
    await panel.getByRole("button", { name: "Add selected to Peru", pressed: false }).waitFor();

    // A change of role between those of a number keeps the window; one that
    // leaves the column no number closes it.
    await grid
      .getByRole("combobox", { name: "Role of height", exact: true })
      .selectOption("latitude");
    await waitForText(status, "Drawing 5 of 6 individuals");
    await grid
      .getByRole("combobox", { name: "Role of height", exact: true })
      .selectOption("category");
    await histogram.waitForEvent("close");
    assert.deepEqual(app.windows(), ["main"]);

    // With no column of numbers, the bar says so, and how to make one.
    assert.equal((await backend.send({ command: "e2e:load", table: NO_NUMBERS })).ok, null);
    await grid.getByRole("combobox", { name: "Role of note", exact: true }).waitFor();
    await choose("histogram");
    await page
      .getByRole("alert")
      .filter({ hasText: "No histogram was opened: the table has no column of numbers." })
      .waitFor();
    assert.deepEqual(app.windows(), ["main"]);

    assert.deepEqual(errors, []);
    console.log(`e2e histogram, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/**
 * Waits until the segments outlined, those holding individuals selected,
 * are those at `segments`, by their places in the bars: what the
 * histogram's own copy of the selection has.
 */
async function outlinedAre(page, segments) {
  await page.waitForFunction((expected) => {
    const document = globalThis.document;
    const rects = [...document.querySelectorAll("[data-segment]")];
    const outlined = [...document.querySelectorAll(".plot-histogram-outline")].map((outline) => {
      const box = outline.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      return rects.findIndex((rect) => {
        const holder = rect.getBoundingClientRect();
        return x >= holder.left && x <= holder.right && y >= holder.top && y <= holder.bottom;
      });
    });
    return JSON.stringify(outlined.toSorted((a, b) => a - b)) === JSON.stringify(expected);
  }, segments);
}

/** The fill of each segment, in their order, as the browser computes it. */
async function fills(page) {
  return page.evaluate(() =>
    [...globalThis.document.querySelectorAll("[data-segment]")].map(
      (rect) => globalThis.getComputedStyle(rect).fill,
    ),
  );
}

/** The colour of the token `name`, as the browser computes it. */
async function tokenColour(page, name) {
  return page.evaluate((token) => {
    const probe = globalThis.document.createElement("div");
    probe.style.color = `var(${token})`;
    globalThis.document.body.append(probe);
    const colour = globalThis.getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
}

/** The centre of the segment at `index`, in CSS pixels of the window. */
async function placeOf(page, index) {
  const place = await page.evaluate((segment) => globalThis.__vavilovPlot?.placeOf(segment), index);
  assert.ok(place, `segment ${index} is not drawn`);
  return place;
}

/** Moves the pointer over the segment at `index`. */
async function hover(page, index) {
  const { x, y } = await placeOf(page, index);
  await page.mouse.move(x, y);
}

/** Clicks the segment at `index`, with `key` held when one is given. */
async function clickSegment(page, index, key) {
  const { x, y } = await placeOf(page, index);
  if (key !== undefined) {
    await page.keyboard.down(key);
  }
  await page.mouse.click(x, y);
  if (key !== undefined) {
    await page.keyboard.up(key);
  }
}

/** The label beside the pointer. */
function label(page) {
  return page.locator('p[aria-hidden="true"]');
}

/** Waits until the rows selected in the table are those of `names`, in order. */
async function selectedAre(page, names) {
  await page.waitForFunction(
    (expected) =>
      JSON.stringify(
        [...globalThis.document.querySelectorAll('[role="row"][aria-selected="true"]')].map((row) =>
          row.querySelector('[role="gridcell"]')?.textContent?.trim(),
        ),
      ) === JSON.stringify(expected),
    names,
  );
}

/** Waits until the cell of origin, the second, of the row of `name` says `text`. */
async function originSays(grid, name, text) {
  await grid
    .getByRole("row")
    .filter({ has: grid.page().getByRole("gridcell", { name, exact: true }) })
    .getByRole("gridcell")
    .nth(1)
    .filter({ hasText: text })
    .waitFor();
}

/** Waits until `locator` says `text`. */
async function waitForText(locator, text) {
  await locator.filter({ hasText: text }).waitFor();
}

/** Writes `page` in light and in dark, for a person to look at. */
async function shoot(page, engine, name) {
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.screenshot({ path: `${OUT}${name}-${colorScheme}-${engine}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}
