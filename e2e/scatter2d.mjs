// The 2D scatter of the Plots window against the real core, in each
// engine. Plot > 2D scatter… asks for two columns of numbers, starting from
// the first two plain numbers, and opens a tile of the Plots window: each
// point where its values are, in its group's colour, over a light grid and
// two axes named after the columns; the pointer over a point names it, a
// click selects it, Cmd-click or Ctrl-click adds it; a drag pans, the wheel
// and + zoom, the arrows pan, Home and a double click frame every point
// again, and nothing rotates; + pressed in the groups panel arms a lasso,
// which Enter applies. The tile sits beside a histogram, a change of role
// that leaves an axis no number closes it, and with no column of numbers
// the main window says so.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";
import { centreOfColour } from "./pixels.mjs";

/**
 * Six plants: 1 origin, a category, active: Spain (p1, p3, p6), Peru (p2,
 * p5), p4 unassigned; 2 PC1 and 3 PC2, numbers, PC2 missing for p6; 4 lat,
 * a latitude. On PC1 against PC2, p1 is at 0, 0, p2 at 1, 4, p3 at 2, 1,
 * p4 at 3, 3 and p5 at 4, 2.
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
      codes: [0, 1, 0, null, 1, 0],
    },
    { name: "PC1", numeric: [0, 1, 2, 3, 4, 2] },
    { name: "PC2", numeric: [0, 4, 1, 3, 2, null] },
    { name: "lat", numeric: [40, 41, 42, 43, 44, 45], role: "latitude" },
  ],
  activeClassification: 1,
};

/**
 * Two plants with no value on both PC1 and PC2: p1 lacks PC2 and p2 lacks
 * PC1, so a 2D scatter of them draws nothing until a value is given.
 */
const APART = {
  header: "IndividualID",
  names: ["p1", "p2"],
  columns: [
    { name: "PC1", numeric: [1200, null] },
    { name: "PC2", numeric: [null, 35] },
  ],
  activeClassification: null,
};

/** Two plants with no column of numbers. */
const NO_NUMBERS = {
  header: "IndividualID",
  names: ["p1", "p2"],
  columns: [{ name: "note", text: ["tall", "short"] }],
  activeClassification: null,
};

/** The colours of the groups, as PLANTS gives them. */
const SPAIN = [230, 159, 0];
const PERU = [86, 180, 233];

/** The widget of the 2D scatter, the first opened. */
const SCATTER = 1;

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true, viewport: { width: 1000, height: 520 } });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    const grid = page.getByRole("grid", { name: "Individuals" });
    await grid.getByRole("combobox", { name: "Role of PC2", exact: true }).waitFor();
    const choose = async (action) => {
      const sent = await backend.send({ command: "e2e:action", action });
      assert.equal(sent.ok, null, JSON.stringify(sent));
    };

    // 2D scatter… offers the columns of numbers, a latitude among them, and
    // starts from the first two plain numbers.
    await choose("scatter2d");
    const dialog = page.getByRole("dialog", { name: "2D scatter" });
    await dialog.waitFor();
    const xField = dialog.getByRole("combobox", { name: "X axis" });
    const yField = dialog.getByRole("combobox", { name: "Y axis" });
    assert.deepEqual(await xField.locator("option").allTextContents(), ["PC1", "PC2", "lat"]);
    assert.equal(await xField.locator("option:checked").textContent(), "PC1");
    assert.equal(await yField.locator("option:checked").textContent(), "PC2");
    await shoot(page, engine, "scatter2d-dialog");
    await dialog.getByRole("button", { name: "Open" }).click();

    // It opens as a tile of the Plots window, named after its columns, and
    // counts the individuals it cannot draw.
    const plots = await app.window("plots-1");
    await plots.setViewportSize({ width: 1000, height: 640 });
    await plots.waitForFunction(() => globalThis.document.title === "Plots");
    const scatterTile = tile(plots, "2D scatter of PC1 and PC2");
    const plot = scatterTile.getByRole("application", { name: "2D scatter of PC1 and PC2" });
    await plot.waitFor();
    await waitForText(
      scatterTile.getByRole("status"),
      "Drawing 5 of 6 individuals: 1 has no value on an axis.",
    );

    // Each point is where its values are: PC1 to the right, PC2 up; and in
    // its group's colour.
    const p1 = await steadyPlace(plots, 0);
    const p2 = await steadyPlace(plots, 1);
    const p3 = await steadyPlace(plots, 2);
    const p4 = await steadyPlace(plots, 3);
    const p5 = await steadyPlace(plots, 4);
    assert.ok(p1.x < p2.x && p2.x < p3.x && p3.x < p4.x && p4.x < p5.x, "PC1 runs to the right");
    assert.ok(p2.y < p4.y && p4.y < p5.y && p5.y < p3.y && p3.y < p1.y, "PC2 runs up");
    // One unit of PC1 is as wide between every pair of neighbours.
    assert.ok(Math.abs(p2.x - p1.x - (p3.x - p2.x)) < 1, "PC1 is not linear");
    assert.equal(await plots.evaluate(() => globalThis.__vavilovPlotOf?.(1)?.placeOf(5)), null);
    await assertDrawnAt(plots, p1, SPAIN, "p1");
    await assertDrawnAt(plots, p2, PERU, "p2");
    // The axes are named after the columns, and a light grid lies behind.
    const [xTitle, yTitle] = await plot.evaluate((svg) =>
      ["PC1", "PC2"].map((name) => {
        const title = [...svg.querySelectorAll(".plot-scatter2d-title")].find(
          (text) => text.textContent === name,
        );
        const box = title?.getBoundingClientRect();
        return box === undefined ? null : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }),
    );
    assert.ok(xTitle.y > p1.y && xTitle.x > p1.x, "PC1 is not named under its axis");
    assert.ok(yTitle.x < p1.x && yTitle.y < p1.y, "PC2 is not named beside its axis");
    // The plot keeps a touch for itself, which a web view would take as a scroll.
    assert.equal(
      await plot.evaluate((svg) => globalThis.getComputedStyle(svg).touchAction),
      "none",
    );
    assert.ok((await scatterTile.locator(".plot-scatter2d-grid line").count()) >= 4);
    await shoot(plots, engine, "scatter2d-points");

    // The pointer over a point shows its label, as in the 3D scatter.
    await plots.mouse.move(p3.x, p3.y);
    const pointLabel = plots.locator('[aria-hidden="true"]').filter({ hasText: "p3" });
    await pointLabel.waitFor();
    assert.match(await pointLabel.textContent(), /p3\s*origin\s*Spain/);
    // The hover is drawn larger than the rest, 16 pixels across, over all.
    await plots.waitForFunction(() => {
      const top = globalThis.document.querySelectorAll(".plot-scatter2d-layer")[2];
      return (
        top?.children.length === 1 && top.firstElementChild.getAttribute("d").startsWith("M8,")
      );
    });
    await shoot(plots, engine, "scatter2d-label");

    // A click selects an individual alone; Cmd-click or Ctrl-click adds
    // another.
    await plots.mouse.click(p1.x, p1.y);
    await selectedAre(page, ["p1"]);
    await plots.keyboard.down("ControlOrMeta");
    await plots.mouse.click(p2.x, p2.y);
    await plots.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p1", "p2"]);
    await shoot(plots, engine, "scatter2d-selected");

    // With the keyboard's focus on it, an arrow pans and Home frames every
    // point again; + zooms in; a double click frames them too.
    await plot.focus();
    // p1 is near the left edge, and goes out of the axes: p3 is followed.
    await plots.keyboard.press("ArrowRight");
    const panned = await steadyPlace(plots, 2);
    assert.ok(panned.x < p3.x - 20, `ArrowRight did not pan: ${p3.x} to ${panned.x}`);
    assert.ok(Math.abs(panned.y - p3.y) < 1, "ArrowRight moved the points up or down");
    await assertDrawnAt(plots, panned, SPAIN, "p3 after ArrowRight");
    // p1, gone out of the axes, is not drawn, nor picked.
    assert.equal(await plots.evaluate(() => globalThis.__vavilovPlotOf?.(1)?.placeOf(0)), null);
    await plots.keyboard.press("ArrowLeft");
    await samePlace(plots, 2, p3, "ArrowLeft did not pan back");
    await plots.keyboard.press("ArrowUp");
    const up = await steadyPlace(plots, 2);
    assert.ok(up.y > p3.y + 20 && Math.abs(up.x - p3.x) < 1, `ArrowUp moved p3 to ${up.y}`);
    await plots.keyboard.press("ArrowDown");
    await samePlace(plots, 2, p3, "ArrowDown did not pan back");
    for (const key of ["-", "−"]) {
      // Playwright has no key for the minus sign, which some layouts type.
      if (key === "−") {
        await plot.evaluate((svg, typed) => {
          svg.dispatchEvent(new globalThis.KeyboardEvent("keydown", { key: typed, bubbles: true }));
        }, key);
      } else {
        await plots.keyboard.press(key);
      }
      const far3 = await steadyPlace(plots, 2);
      const far4 = await steadyPlace(plots, 3);
      assert.ok(
        Math.hypot(far4.x - far3.x, far4.y - far3.y) < Math.hypot(p4.x - p3.x, p4.y - p3.y) - 5,
        `${key} did not zoom out`,
      );
      await plots.keyboard.press("Home");
      await samePlace(plots, 0, p1, "Home did not frame every point");
    }
    await plots.keyboard.press("Home");
    await samePlace(plots, 0, p1, "Home did not frame every point");
    await plots.keyboard.press("+");
    // About the middle, where p3 and p4 stay inside the axes.
    const nearP3 = await steadyPlace(plots, 2);
    const nearP4 = await steadyPlace(plots, 3);
    assert.ok(
      Math.hypot(nearP4.x - nearP3.x, nearP4.y - nearP3.y) >
        Math.hypot(p4.x - p3.x, p4.y - p3.y) + 10,
      "+ did not zoom in",
    );
    const box = await plot.boundingBox();
    const empty = { x: box.x + box.width - 40, y: box.y + 40 };
    await plots.mouse.dblclick(empty.x, empty.y);
    await samePlace(plots, 0, p1, "a double click did not frame every point");

    // A drag pans, and nothing rotates: the points keep their distances.
    await plots.mouse.move(empty.x, empty.y);
    await plots.mouse.down();
    await plots.mouse.move(empty.x - 60, empty.y + 30, { steps: 6 });
    await plots.mouse.up();
    const dragged3 = await steadyPlace(plots, 2);
    const dragged4 = await steadyPlace(plots, 3);
    assert.ok(Math.abs(dragged3.x - (p3.x - 60)) < 2, `the drag moved p3 to ${dragged3.x}`);
    assert.ok(Math.abs(dragged3.y - (p3.y + 30)) < 2, `the drag moved p3 to ${dragged3.y}`);
    assert.ok(Math.abs(dragged4.x - dragged3.x - (p4.x - p3.x)) < 1, "the drag turned the plot");
    assert.ok(Math.abs(dragged4.y - dragged3.y - (p4.y - p3.y)) < 1, "the drag turned the plot");
    await assertDrawnAt(plots, dragged3, SPAIN, "p3 after the drag");

    // A capture the plot lost, with no release, ends the pan: a drag that
    // comes back does not move the view.
    await plots.mouse.move(empty.x - 60, empty.y + 30);
    await plots.mouse.down();
    await plot.evaluate((svg) => {
      svg.parentElement.dispatchEvent(
        new globalThis.PointerEvent("lostpointercapture", { pointerId: 1 }),
      );
    });
    await plots.mouse.move(empty.x - 120, empty.y + 60, { steps: 4 });
    await plots.mouse.up();
    await samePlace(plots, 2, dragged3, "a drag panned after the capture was lost");

    // A second finger neither pans nor throws.
    await plot.evaluate((svg) => {
      const frame = svg.parentElement;
      const box = frame.getBoundingClientRect();
      const at = { clientX: box.left + 200, clientY: box.top + 200, pointerId: 7 };
      const touch = { ...at, isPrimary: false, pointerType: "touch", bubbles: true };
      svg.dispatchEvent(
        new globalThis.PointerEvent("pointerdown", { ...touch, button: 0, buttons: 1 }),
      );
      svg.dispatchEvent(
        new globalThis.PointerEvent("pointermove", {
          ...touch,
          clientX: at.clientX + 80,
          buttons: 1,
        }),
      );
      svg.dispatchEvent(
        new globalThis.PointerEvent("pointerup", { ...touch, button: 0, buttons: 0 }),
      );
    });
    await samePlace(plots, 2, dragged3, "a second finger panned");
    // The wheel zooms where the pointer is: the point under it stays.
    await plots.mouse.move(dragged3.x, dragged3.y);
    await plots.mouse.wheel(0, -200);
    await samePlace(plots, 2, dragged3, "the wheel moved the point under the pointer");
    const wheeled4 = await steadyPlace(plots, 3);
    assert.ok(
      Math.hypot(wheeled4.x - dragged3.x, wheeled4.y - dragged3.y) >
        Math.hypot(p4.x - p3.x, p4.y - p3.y) + 10,
      "the wheel did not zoom in",
    );
    await plot.focus();
    await plots.keyboard.press("Home");
    await samePlace(plots, 0, p1, "Home did not frame every point");

    // + pressed in the groups panel arms the lasso; a lasso around p4,
    // applied with Enter, puts it in Spain.
    const plotsPanel = plots.getByRole("region", { name: "Groups" });
    await plotsPanel.getByRole("button", { name: /^Spain/ }).click();
    await plotsPanel.getByRole("button", { name: "Add selected to Spain", exact: true }).click();
    await plotsPanel
      .getByRole("button", { name: "Add selected to Spain", pressed: true })
      .waitFor();
    await plots.locator(".plot-lasso-armed").first().waitFor();
    // The bar's message took height from the plot, and moved the points.
    const armed4 = await steadyPlace(plots, 3);
    await plots.mouse.move(armed4.x - 20, armed4.y - 20);
    await plots.mouse.down();
    await plots.mouse.move(armed4.x + 20, armed4.y - 20, { steps: 5 });
    await samePlace(plots, 3, armed4, "the lasso panned the plot");
    for (const [toX, toY] of [
      [armed4.x + 20, armed4.y + 20],
      [armed4.x - 20, armed4.y + 20],
      [armed4.x - 20, armed4.y - 20],
    ]) {
      await plots.mouse.move(toX, toY, { steps: 5 });
    }
    await plots.mouse.up();
    await plots.locator('.plot-scatter2d-point[data-mark="2"]').waitFor();
    // A lasso that waits goes when the plot changes size, since it no longer
    // fits the points.
    await plots.setViewportSize({ width: 1000, height: 600 });
    await plots.waitForFunction(
      () => globalThis.document.querySelector('.plot-scatter2d-point[data-mark="2"]') === null,
    );
    await plots.setViewportSize({ width: 1000, height: 640 });
    const again4 = await steadyPlace(plots, 3);
    await lassoAround(plots, again4);
    await shoot(plots, engine, "scatter2d-lasso");
    await plots.keyboard.press("Enter");
    await originSays(grid, "p4", "Spain");
    await plots.keyboard.press("Escape");
    await plotsPanel
      .getByRole("button", { name: "Add selected to Spain", pressed: false })
      .waitFor();
    // p4 is in Spain's colour now.
    await waitForColourNear(plots, again4, SPAIN, "p4 in Spain");

    // A histogram goes into the same window, beside it.
    await choose("histogram");
    const histogramDialog = page.getByRole("dialog", { name: "Histogram" });
    await histogramDialog.waitFor();
    await histogramDialog.getByRole("combobox", { name: "Column" }).selectOption("PC1");
    await histogramDialog.getByRole("button", { name: "Open" }).click();
    await tile(plots, "Histogram of PC1").getByRole("img", { name: "Histogram of PC1" }).waitFor();
    assert.equal(await plots.locator("[data-tile]").count(), 2);
    assert.deepEqual(app.windows(), ["main", "plots-1"]);
    await shoot(plots, engine, "scatter2d-tiles");

    // PC2 made a category leaves the scatter an axis with no number, and
    // closes its tile; the histogram stays.
    await grid.getByRole("combobox", { name: "Role of PC2", exact: true }).selectOption("category");
    await plots.waitForFunction(
      () => globalThis.document.querySelectorAll("[data-tile]").length === 1,
    );
    await tile(plots, "Histogram of PC1").waitFor();

    // A tile opened with no individual to draw frames the first that comes.
    assert.equal((await backend.send({ command: "e2e:load", table: APART })).ok, null);
    await grid.getByRole("combobox", { name: "Role of PC2", exact: true }).waitFor();
    await choose("scatter2d");
    await page
      .getByRole("dialog", { name: "2D scatter" })
      .getByRole("button", { name: "Open" })
      .click();
    const plotsAgain = await app.window("plots-2");
    await plotsAgain.setViewportSize({ width: 1000, height: 640 });
    const apartTile = tile(plotsAgain, "2D scatter of PC1 and PC2");
    await waitForText(
      apartTile.getByRole("status"),
      "Drawing 0 of 2 individuals: 2 have no value on an axis.",
    );
    const pc2 = grid
      .getByRole("row")
      .filter({ has: page.getByRole("gridcell", { name: "p1", exact: true }) })
      .getByRole("gridcell")
      .nth(2);
    await pc2.dblclick();
    // Far from 35, the centre of the column, which the empty tile drew around.
    await page.keyboard.type("50");
    await page.keyboard.press("Enter");
    await waitForText(apartTile.getByRole("status"), "Drawing 1 of 2 individuals");
    // The widgets are numbered across the tables: the scatter, the
    // histogram, and this one.
    await steadyPlace(plotsAgain, 0, 3);

    // With no column of numbers, the bar says so, and how to make one.
    assert.equal((await backend.send({ command: "e2e:load", table: NO_NUMBERS })).ok, null);
    await grid.getByRole("combobox", { name: "Role of note", exact: true }).waitFor();
    await choose("scatter2d");
    await page
      .getByRole("alert")
      .filter({ hasText: "No 2D scatter was opened: the table has no column of numbers." })
      .waitFor();

    assert.deepEqual(errors, []);
    console.log(`e2e scatter2d, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/** The tile named `name`, by its title. */
function tile(page, name) {
  return page.getByRole("group", { name, exact: true });
}

/**
 * The place of the point of `row` on the 2D scatter of `widget`, once it is
 * the same twice in a row.
 */
async function steadyPlace(page, row, widget = SCATTER) {
  const deadline = Date.now() + 10_000;
  let last = null;
  for (;;) {
    const place = await page.evaluate(
      ([widget, r]) => globalThis.__vavilovPlotOf?.(widget)?.placeOf(r) ?? null,
      [widget, row],
    );
    if (place !== null && last !== null && place.x === last.x && place.y === last.y) {
      return place;
    }
    assert.ok(Date.now() < deadline, `row ${row} has no steady place: ${JSON.stringify(place)}`);
    last = place;
    await page.waitForTimeout(100);
  }
}

/** Waits, for at most five seconds, until the point of `row` is within 1 pixel of `place`. */
async function samePlace(page, row, place, what) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const now = await steadyPlace(page, row);
    if (Math.hypot(now.x - place.x, now.y - place.y) < 1) {
      return;
    }
    assert.ok(
      Date.now() < deadline,
      `${what}: ${JSON.stringify(now)}, not ${JSON.stringify(place)}`,
    );
    await page.waitForTimeout(100);
  }
}

/** Checks that the pixels drawn in `colour` around `place` are centred within 1 pixel of it. */
async function assertDrawnAt(page, place, colour, what) {
  const centre = await centreOfColour(page, place.x, place.y, colour);
  assert.ok(centre !== null, `${what}: no pixel of ${colour} near ${JSON.stringify(place)}`);
  const off = Math.hypot(centre.x - place.x, centre.y - place.y);
  assert.ok(
    off <= 1,
    `${what}: drawn at ${JSON.stringify(centre)}, placed at ${JSON.stringify(place)}`,
  );
}

/** Waits, for at most five seconds, until a pixel within 8 pixels of `place` is `expected`. */
async function waitForColourNear(page, place, expected, what) {
  const deadline = Date.now() + 5000;
  for (;;) {
    if ((await centreOfColour(page, place.x, place.y, expected, 8)) !== null) {
      return;
    }
    assert.ok(
      Date.now() < deadline,
      `${what}: no pixel of ${expected} near ${JSON.stringify(place)}`,
    );
    await page.waitForTimeout(100);
  }
}

/** Draws a lasso of a square 40 pixels wide around `place`. */
async function lassoAround(plot, place) {
  const { x, y } = place;
  await plot.mouse.move(x - 20, y - 20);
  await plot.mouse.down();
  for (const [toX, toY] of [
    [x + 20, y - 20],
    [x + 20, y + 20],
    [x - 20, y + 20],
    [x - 20, y - 20],
  ]) {
    await plot.mouse.move(toX, toY, { steps: 5 });
  }
  await plot.mouse.up();
}

/** Waits until the rows of the main window's table drawn as selected are `names`. */
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
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
        }),
    );
    await page.screenshot({ path: `${OUT}${name}-${colorScheme}-${engine}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}
