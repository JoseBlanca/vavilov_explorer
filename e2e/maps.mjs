// The windows of the two maps against the real core, in each engine. Plot >
// Map of countries… asks for a column of countries and opens a map that
// fills each country by how many individuals it holds, says in its
// information bar those it cannot draw, names a country under the pointer,
// and selects a country's individuals on a click; with groups selected it
// counts only theirs. Plot > Map… asks for a latitude and a longitude column
// and opens a map of the individuals, each point drawn where it is placed,
// whose lasso + pressed in its groups panel arms. Both panels have + and −
// but no Add, Edit and Delete group; a change of role that leaves a map a
// column it cannot show closes it; and with no fitting column the main
// window says so.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";
import { centreOfColour, pixelAt } from "./pixels.mjs";

/**
 * Seven plants: 1 origin, a column of countries, active: three in Spain,
 * one in Peru, two with none and one in French Guiana, which the map
 * draws inside France; 2 lat and 3 lon, the coordinates, missing for p6,
 * and p7 at the very place of p1, Madrid; 4 PC1, a number.
 */
const PLACES = {
  header: "IndividualID",
  names: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  columns: [
    {
      name: "origin",
      text: ["Spain", "ES", "Peru", null, "French Guiana", "ESP", null],
      role: "country",
    },
    { name: "lat", numeric: [40.4, 41.4, -12, 10, 4, null, 40.4], role: "latitude" },
    { name: "lon", numeric: [-3.7, 2.2, -77, 10, -53, null, -3.7], role: "longitude" },
    { name: "PC1", numeric: [-0.5, 0.25, 1, 2, 3, 4, 5] },
  ],
  activeClassification: 1,
};

/** Two plants with no coordinates and no country. */
const NO_PLACES = {
  header: "IndividualID",
  names: ["p1", "p2"],
  columns: [{ name: "height", numeric: [1.5, 2] }],
  activeClassification: null,
};

/** The colours of the map of countries in the light appearance (src/styles/tokens.css). */
const COUNTRY_EMPTY = [228, 228, 233];
const COUNT_LOW = [166, 203, 232];
const COUNT_HIGH = [8, 48, 107];
/** The colour of the text, of the line around a country holding the selection. */
const TEXT = [29, 29, 31];

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true, viewport: { width: 1000, height: 520 } });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLACES })).ok, null);
    const grid = page.getByRole("grid", { name: "Individuals" });
    await grid.getByRole("combobox", { name: "Role of lat", exact: true }).waitFor();
    const choose = async (action) => {
      const sent = await backend.send({ command: "e2e:action", action });
      assert.equal(sent.ok, null, JSON.stringify(sent));
    };

    // Map of countries… offers the columns of countries, and opens the map
    // of the one chosen, named after it.
    await choose("countryMap");
    const countryDialog = page.getByRole("dialog", { name: "Map of countries" });
    await countryDialog.waitFor();
    const countryField = countryDialog.getByRole("combobox", { name: "Country column" });
    assert.deepEqual(await countryField.locator("option").allTextContents(), ["origin"]);
    await shoot(page, engine, "maps-country-dialog");
    await countryDialog.getByRole("button", { name: "Open" }).click();
    const countries = await app.window("countryMap-1");
    await countries.setViewportSize({ width: 1000, height: 640 });
    await countries.waitForFunction(
      () => globalThis.document.title === "Map of countries in origin",
    );
    await countries.getByRole("application", { name: "Map of countries in origin" }).waitFor();

    // The bar counts those it cannot draw, and the legend its scale.
    await waitForText(
      countries.getByRole("status"),
      "Counting 4 of 7 individuals: 2 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    const legend = countries.getByRole("region", { name: "Individuals per country" });
    await legend.getByText("No individuals").waitFor();
    assert.match(await legend.textContent(), /No individuals\s*1\s*3/);
    // A screen reader is given the scale as a sentence, not two numbers.
    const legendRead = await legend.ariaSnapshot();
    assert.match(legendRead, /From 1 to 3 individuals/);
    assert.doesNotMatch(legendRead, /paragraph: 1 3/);
    // The legend lets the pointer through to the map under it, which pans,
    // zooms and picks a country there too.
    const legendBox = await legend.boundingBox();
    assert.equal(
      await countries.evaluate(
        ([x, y]) => globalThis.document.elementFromPoint(x, y)?.tagName,
        [legendBox.x + legendBox.width / 2, legendBox.y + legendBox.height / 2],
      ),
      "CANVAS",
    );

    // The groups panel chooses the classification and the groups, and
    // offers + and − on the group selected, but no Add, Edit or Delete
    // group.
    const countryPanel = countries.getByRole("region", { name: "Groups" });
    await countryPanel.getByRole("combobox", { name: "Classification column" }).waitFor();
    await countryPanel.getByRole("button", { name: /^ESP/ }).click();
    await countryPanel.getByRole("button", { name: "Add selected to ESP", exact: true }).waitFor();
    await countryPanel.getByRole("button", { name: "Remove selected from ESP" }).waitFor();
    await assertNoGroupForms(countryPanel);
    await countryPanel.getByRole("button", { name: /^ESP/ }).click();

    // Spain holds the most, Peru one, Morocco none: each is filled with its
    // colour on the scale, as drawn on the GPU.
    const madrid = await steadyDegrees(countries, 40, -3.7);
    const lima = await steadyDegrees(countries, -10, -75);
    const morocco = await steadyDegrees(countries, 32, -6);
    assertColour(await pixelAt(countries, madrid.x, madrid.y), COUNT_HIGH, "Spain");
    assertColour(await pixelAt(countries, lima.x, lima.y), COUNT_LOW, "Peru");
    assertColour(await pixelAt(countries, morocco.x, morocco.y), COUNTRY_EMPTY, "Morocco");
    // A shape ISO has no code for, as Somaliland, is land of no individual,
    // not sea.
    const somaliland = await steadyDegrees(countries, 9.5, 46);
    assertColour(await pixelAt(countries, somaliland.x, somaliland.y), COUNTRY_EMPTY, "Somaliland");

    // The map counts every individual, whatever the find bar of the main
    // window shows.
    const find = page
      .getByRole("search", { name: "Find in the table" })
      .getByRole("searchbox", { name: "Find" });
    await find.fill("Peru");
    await grid.getByRole("gridcell", { name: "p1", exact: true }).waitFor({ state: "detached" });
    await waitForText(
      countries.getByRole("status"),
      "Counting 4 of 7 individuals: 2 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    assertColour(await pixelAt(countries, madrid.x, madrid.y), COUNT_HIGH, "Spain, filtered");
    await find.fill("");
    await grid.getByRole("gridcell", { name: "p1", exact: true }).waitFor();
    await shoot(countries, engine, "maps-countries");

    // The pointer over a country names it and counts its individuals.
    await countries.mouse.move(madrid.x, madrid.y);
    const countryLabel = countries.locator('[aria-hidden="true"]').filter({ hasText: "Spain" });
    await waitForText(countryLabel, "Spain (ESP): 3 individuals");
    await countries.mouse.move(morocco.x, morocco.y);
    await waitForText(
      countries.locator('[aria-hidden="true"]').filter({ hasText: "Morocco" }),
      "Morocco: no individuals",
    );
    await shoot(countries, engine, "maps-country-label");

    // A click on a country selects its individuals alone; a Cmd-click or a
    // Ctrl-click adds another's, and takes them away when all are selected.
    // A click on a country of none changes nothing.
    await countries.mouse.click(madrid.x, madrid.y);
    await selectedAre(page, ["p1", "p2", "p6"]);
    // Spain, which holds them, has a line in the text's colour round it.
    const spainCoast = await steadyDegrees(countries, 43.45, -5);
    const peruCoast = await steadyDegrees(countries, -12, -77.15);
    await waitForColourNear(countries, spainCoast, TEXT, "the line round Spain");
    // A second click on the country whose individuals are the selection
    // clears it. The map decides a click from its own copy of the
    // selection, so each click waits for the line to show what the map
    // has: the main window's table can show a change first.
    await countries.mouse.click(madrid.x, madrid.y);
    await selectedAre(page, []);
    await waitForNoColourNear(countries, spainCoast, TEXT, "the line round Spain");
    await countries.mouse.click(madrid.x, madrid.y);
    await selectedAre(page, ["p1", "p2", "p6"]);
    await waitForColourNear(countries, spainCoast, TEXT, "the line round Spain");
    await countries.keyboard.down("ControlOrMeta");
    await countries.mouse.click(lima.x, lima.y);
    await countries.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p1", "p2", "p3", "p6"]);
    await countries.keyboard.down("ControlOrMeta");
    await countries.mouse.click(madrid.x, madrid.y);
    await countries.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p3"]);
    await countries.mouse.click(morocco.x, morocco.y);
    // Nor does a click on the sea.
    const atlantic = await steadyDegrees(countries, 30, -40);
    await countries.mouse.click(atlantic.x, atlantic.y);
    await countries.mouse.move(lima.x, lima.y);
    await selectedAre(page, ["p3"]);
    // The line goes round Peru now, and no longer round Spain.
    await waitForColourNear(countries, peruCoast, TEXT, "the line round Peru");
    assert.equal(
      await centreOfColour(countries, spainCoast.x, spainCoast.y, TEXT, 8),
      null,
      "a line round Spain, which holds no individual selected",
    );
    await shoot(countries, engine, "maps-country-selected");

    // With groups selected, the map counts their individuals alone, and the
    // bar and the legend say whose. The classification is the column of
    // countries itself, so ESP leaves Spain alone coloured.
    const countryStatus = countries.getByRole("status");
    await countryPanel.getByRole("button", { name: /^ESP/ }).click();
    await waitForText(countryStatus, "Counting the 3 individuals in ESP, of 7.");
    await waitForColour(countries, lima, COUNTRY_EMPTY, "Peru, ESP alone selected");
    assertColour(await pixelAt(countries, madrid.x, madrid.y), COUNT_HIGH, "Spain, ESP selected");
    await legend.getByText("in ESP", { exact: true }).waitFor();
    assert.match(await legend.ariaSnapshot(), /From 1 to 3 individuals in ESP/);
    await shoot(countries, engine, "maps-countries-groups");
    // The unassigned individuals, added with a Cmd-click or a Ctrl-click,
    // are those with no country.
    await countries.keyboard.down("ControlOrMeta");
    await countryPanel.getByRole("button", { name: /^Unassigned/ }).click();
    await countries.keyboard.up("ControlOrMeta");
    await waitForText(
      countryStatus,
      "Counting 3 of the 5 individuals in ESP and in no group: 2 have no country.",
    );
    // A click on the group selected alone selects it alone, and a second
    // click selects nothing: every individual is counted again.
    await countryPanel.getByRole("button", { name: /^ESP/ }).click();
    await waitForText(countryStatus, "Counting the 3 individuals in ESP, of 7.");
    await countryPanel.getByRole("button", { name: /^ESP/ }).click();
    await waitForText(
      countryStatus,
      "Counting 4 of 7 individuals: 2 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    await waitForColour(countries, lima, COUNT_LOW, "Peru, no group selected");
    assert.equal(await legend.getByText("in ESP", { exact: true }).count(), 0);

    // Deleting the group of Peru in the main window leaves Peru with none,
    // and undoing it gives it back its individual.
    const panel = page.getByRole("region", { name: "Groups" });
    await panel.getByRole("button", { name: /^PER/ }).click();
    await panel.getByRole("button", { name: "Delete group PER" }).click();
    await waitForText(
      countries.getByRole("status"),
      "Counting 3 of 7 individuals: 3 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    await waitForColour(countries, lima, COUNTRY_EMPTY, "Peru, its group deleted");
    await choose("undo");
    await waitForText(
      countries.getByRole("status"),
      "Counting 4 of 7 individuals: 2 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    await waitForColour(countries, lima, COUNT_LOW, "Peru, its group back");

    // Map… offers the latitude and the longitude columns, and opens the map
    // of the individuals, named after them.
    await choose("map");
    const mapDialog = page.getByRole("dialog", { name: "Map" });
    await mapDialog.waitFor();
    const latitudeField = mapDialog.getByRole("combobox", { name: "Latitude column" });
    const longitudeField = mapDialog.getByRole("combobox", { name: "Longitude column" });
    assert.deepEqual(await latitudeField.locator("option").allTextContents(), ["lat"]);
    assert.deepEqual(await longitudeField.locator("option").allTextContents(), ["lon"]);
    await shoot(page, engine, "maps-dialog");
    await mapDialog.getByRole("button", { name: "Open" }).click();
    const map = await app.window("map-2");
    await map.setViewportSize({ width: 1000, height: 640 });
    await map.waitForFunction(() => globalThis.document.title === "Map of lat and lon");
    await waitForText(map.getByRole("status"), "Drawing 6 of 7 individuals: 1 has no coordinates.");
    const mapPanel = map.getByRole("region", { name: "Groups" });
    await mapPanel.getByRole("button", { name: /^ESP/ }).waitFor();
    await assertNoGroupForms(mapPanel);

    // Each point is drawn where its coordinates are on the map, in its
    // group's colour.
    const colours = await levelColours(backend);
    const p1 = await steadyPlace(map, 0);
    const p2 = await steadyPlace(map, 1);
    const p3 = await steadyPlace(map, 2);
    const atMadrid = await map.evaluate(() => globalThis.__vavilovPlot?.placeOfDegrees(40.4, -3.7));
    assert.ok(Math.hypot(atMadrid.x - p1.x, atMadrid.y - p1.y) < 0.5, "p1 is not at Madrid");
    await shoot(map, engine, "maps-points");
    await assertDrawnAt(map, p2, colours.get("ESP"), "p2");
    await assertDrawnAt(map, p3, colours.get("PER"), "p3");

    // The pointer over a point shows its label, as in the 3D scatter.
    await map.mouse.move(p3.x, p3.y);
    const pointLabel = map.locator('[aria-hidden="true"]').filter({ hasText: "p3" });
    await pointLabel.waitFor();
    assert.match(await pointLabel.textContent(), /p3\s*origin\s*PER/);
    await shoot(map, engine, "maps-label");

    // A click on a point selects it alone, and the individual selected is
    // drawn over p7, of no group, at the same place.
    await map.mouse.click(p1.x, p1.y);
    await selectedAre(page, ["p1"]);
    await waitForColour(map, p1, colours.get("ESP"), "p1 selected, over p7");

    // With the keyboard's focus, an arrow pans, + zooms and Home shows all
    // the individuals again, and so does a double click.
    const mapPlot = map.getByRole("application", { name: "Map of lat and lon" });
    await mapPlot.focus();
    await map.keyboard.press("ArrowRight");
    const panned = await steadyDegrees(map, 40.4, -3.7);
    assert.ok(panned.x < p1.x - 50, `ArrowRight did not pan: ${p1.x} to ${panned.x}`);
    await map.keyboard.press("Home");
    // The window was made larger after the map first framed itself, and
    // Home frames the individuals again at its size now: Madrid moves back
    // right of where the arrow took it.
    const home = await steadyDegrees(map, 40.4, -3.7);
    assert.ok(home.x > panned.x + 50, `Home did not pan back: ${panned.x} to ${home.x}`);
    await map.keyboard.press("+");
    const zoomed = await steadyPlace(map, 2);
    assert.ok(
      Math.hypot(zoomed.x - home.x, zoomed.y - home.y) > Math.hypot(p3.x - p1.x, p3.y - p1.y),
      "+ did not zoom in",
    );
    const sea = await steadyDegrees(map, 20, -40);
    await map.mouse.dblclick(sea.x, sea.y);
    const framed = await steadyDegrees(map, 40.4, -3.7);
    assert.ok(Math.hypot(framed.x - home.x, framed.y - home.y) < 1, "a double click did not frame");
    await selectedAre(page, ["p1"]);

    // The map's panel has + and − on the group selected, and still no
    // Add, Edit or Delete group. + pressed there arms the map's lasso, and
    // shows pressed in the main window too: a lasso drawn around p3 and
    // applied with Enter puts it in Spain.
    await mapPanel.getByRole("button", { name: /^ESP/ }).click();
    await mapPanel.getByRole("button", { name: "Remove selected from ESP" }).waitFor();
    await assertNoGroupForms(mapPanel);
    await mapPanel.getByRole("button", { name: "Add selected to ESP", exact: true }).click();
    await mapPanel.getByRole("button", { name: "Add selected to ESP", pressed: true }).waitFor();
    await panel.getByRole("button", { name: "Add selected to ESP", pressed: true }).waitFor();
    // The map's cursor shows the lasso armed, once the message of the
    // button pressed has come back: a drag before it pans.
    await map.locator(".plot-lasso-armed").waitFor();
    // The keys and the double click moved the map since p3 was found.
    await lassoAround(map, await steadyPlace(map, 2));
    await shoot(map, engine, "maps-lasso");
    await map.keyboard.press("Enter");
    await originSays(grid, "p3", "ESP");
    // Escape in the map's window releases +, in every window, and keeps
    // the selection; a second Escape clears it.
    await map.keyboard.press("Escape");
    await panel.getByRole("button", { name: "Add selected to ESP", pressed: false }).waitFor();
    await mapPanel.getByRole("button", { name: "Add selected to ESP", pressed: false }).waitFor();
    await selectedAre(page, ["p1"]);
    await map.keyboard.press("Escape");
    await selectedAre(page, []);
    // The map of countries counts p3 in Spain now: Spain holds 4, and Peru
    // none.
    await legend.filter({ hasText: /No individuals\s*1\s*4/ }).waitFor();
    // The bar's message of the release took a line from the map's height,
    // and the map with it: Peru is found again.
    const peru = await steadyDegrees(countries, -10, -75);
    await waitForColour(countries, peru, COUNTRY_EMPTY, "Peru with none");

    // A change of role that leaves the map a column it cannot show closes
    // it: a latitude made a plain number, and the countries a category.
    await grid.getByRole("combobox", { name: "Role of lat", exact: true }).selectOption("number");
    await map.waitForEvent("close");
    await grid
      .getByRole("combobox", { name: "Role of origin", exact: true })
      .selectOption("category");
    await countries.waitForEvent("close");
    assert.deepEqual(app.windows(), ["main"]);

    // With no column of a role a map needs, the bar says which, and how to
    // make one.
    assert.equal((await backend.send({ command: "e2e:load", table: NO_PLACES })).ok, null);
    await grid.getByRole("combobox", { name: "Role of height", exact: true }).waitFor();
    await choose("map");
    const noMap = page
      .getByRole("alert")
      .filter({ hasText: "No map was opened: the table has no latitude column." });
    await noMap.waitFor();
    // The bar shows one message at a time, the next once this one goes.
    await noMap.getByRole("button", { name: "Dismiss" }).click();
    await choose("countryMap");
    await page
      .getByRole("alert")
      .filter({ hasText: "No map of countries was opened: the table has no column of countries." })
      .waitFor();
    assert.deepEqual(app.windows(), ["main"]);

    assert.deepEqual(errors, []);
    console.log(`e2e maps, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/** Checks that `panel` offers no Add, Edit or Delete group. */
async function assertNoGroupForms(panel) {
  for (const name of ["Add group", /^Edit group/, /^Delete group/]) {
    assert.equal(await panel.getByRole("button", { name }).count(), 0, String(name));
  }
}

/** The colour of each level of the column of countries, by its code, as `[red, green, blue]`. */
async function levelColours(backend) {
  const answer = await backend.send({ command: "describe_table", window: "main", json: {} });
  const origin = answer.ok.columns.find((column) => column.name === "origin");
  return new Map(
    origin.levels.map((level) => [
      level.value,
      [1, 3, 5].map((start) => Number.parseInt(level.colour.slice(start, start + 2), 16)),
    ]),
  );
}

/**
 * The place of `latitude`, `longitude` in the window of `map`, once the map
 * has stopped moving after its framing.
 */
async function steadyDegrees(map, latitude, longitude) {
  return steady(map, () =>
    map.evaluate(
      ([lat, lon]) => globalThis.__vavilovPlot?.placeOfDegrees(lat, lon) ?? null,
      [latitude, longitude],
    ),
  );
}

/** The place of the point of `row` in the window of `map`, once the map has stopped moving. */
async function steadyPlace(map, row) {
  return steady(map, () => map.evaluate((r) => globalThis.__vavilovPlot?.placeOf(r) ?? null, row));
}

/** The place `placeOf` gives once it is the same twice in a row, within ten seconds. */
async function steady(page, placeOf) {
  const deadline = Date.now() + 10_000;
  let last = null;
  for (;;) {
    const place = await placeOf();
    if (place !== null && last !== null && place.x === last.x && place.y === last.y) {
      return place;
    }
    assert.ok(Date.now() < deadline, `no steady place: ${JSON.stringify(place)}`);
    last = place;
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

/** Checks that a pixel is `expected`, within the rounding of the GPU and of the colour spaces. */
function assertColour(pixel, expected, what) {
  const off = pixel.some((value, index) => Math.abs(value - expected[index]) > 12);
  assert.equal(off, false, `${what}: the pixel is ${pixel}, not ${expected}`);
}

/** Waits, for at most five seconds, until the pixel at `place` is `expected`. */
async function waitForColour(page, place, expected, what) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const pixel = await pixelAt(page, place.x, place.y);
    if (!pixel.some((value, index) => Math.abs(value - expected[index]) > 12)) {
      return;
    }
    assert.ok(Date.now() < deadline, `${what}: the pixel is ${pixel}, not ${expected}`);
    await page.waitForTimeout(100);
  }
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

/** Waits until no pixel near `place` is of `colour`, as the line round a country goes. */
async function waitForNoColourNear(page, place, colour, what) {
  const deadline = Date.now() + 5000;
  for (;;) {
    if ((await centreOfColour(page, place.x, place.y, colour, 8)) === null) {
      return;
    }
    assert.ok(Date.now() < deadline, `${what}: still drawn near ${JSON.stringify(place)}`);
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
    // A point view draws the new appearance on its next frame.
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
