// The maps of the Maps window against the real core, in each engine. Plot >
// Map of countries… asks for a column of countries and opens, as a tile of
// the Maps window, a map that fills each country by how many individuals it
// holds, says in its count those it cannot draw, names a country under the
// pointer, and selects a country's individuals on a click; with groups
// selected it counts only theirs. Plot > Map… asks for a latitude and a
// longitude column and opens a map of the individuals as another tile, each
// point drawn where it is placed, whose lasso + pressed in the groups panel
// arms, and which stays in its tile. The panel has + and − but no Add,
// Edit and Delete group; a tile's button closes it; a change of role that
// leaves a map a column it cannot show closes its tile, and the window with
// its last; and with no fitting column the main window says so.
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

/** The widgets, by their numbers: the map of countries, then two maps of the individuals. */
const COUNTRIES = 1;
const POINTS = 2;
const OTHER_POINTS = 3;

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
    // of the one chosen, named after it, as the first tile of the Maps
    // window.
    await choose("countryMap");
    const countryDialog = page.getByRole("dialog", { name: "Map of countries" });
    await countryDialog.waitFor();
    const countryField = countryDialog.getByRole("combobox", { name: "Country column" });
    assert.deepEqual(await countryField.locator("option").allTextContents(), ["origin"]);
    await shoot(page, engine, "maps-country-dialog");
    await countryDialog.getByRole("button", { name: "Open" }).click();
    const maps = await app.window("maps-1");
    await maps.setViewportSize({ width: 1000, height: 800 });
    await maps.waitForFunction(() => globalThis.document.title === "Maps");
    const countriesTile = tile(maps, "Map of countries in origin");
    await countriesTile.getByRole("application", { name: "Map of countries in origin" }).waitFor();
    const countryStatus = countriesTile.getByRole("status");

    // The tile's count says those it cannot draw, and the legend its scale.
    await waitForText(
      countryStatus,
      "Counting 4 of 7 individuals: 2 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    const legend = countriesTile.getByRole("region", { name: "Individuals per country" });
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
      await maps.evaluate(
        ([x, y]) => globalThis.document.elementFromPoint(x, y)?.tagName,
        [legendBox.x + legendBox.width / 2, legendBox.y + legendBox.height / 2],
      ),
      "CANVAS",
    );

    // The groups panel chooses the classification and the groups, and
    // offers + and − on the group selected, but no Add, Edit or Delete
    // group.
    const mapsPanel = maps.getByRole("region", { name: "Groups" });
    await mapsPanel.getByRole("combobox", { name: "Classification column" }).waitFor();
    await mapsPanel.getByRole("button", { name: /^ESP/ }).click();
    await mapsPanel.getByRole("button", { name: "Add selected to ESP", exact: true }).waitFor();
    await mapsPanel.getByRole("button", { name: "Remove selected from ESP" }).waitFor();
    await assertNoGroupForms(mapsPanel);
    await mapsPanel.getByRole("button", { name: /^ESP/ }).click();

    // Spain holds the most, Peru one, Morocco none: each is filled with its
    // colour on the scale, as drawn on the GPU.
    const madrid = await steadyDegrees(maps, COUNTRIES, 40, -3.7);
    const lima = await steadyDegrees(maps, COUNTRIES, -10, -75);
    const morocco = await steadyDegrees(maps, COUNTRIES, 32, -6);
    assertColour(await pixelAt(maps, madrid.x, madrid.y), COUNT_HIGH, "Spain");
    assertColour(await pixelAt(maps, lima.x, lima.y), COUNT_LOW, "Peru");
    assertColour(await pixelAt(maps, morocco.x, morocco.y), COUNTRY_EMPTY, "Morocco");
    // A shape ISO has no code for, as Somaliland, is land of no individual,
    // not sea.
    const somaliland = await steadyDegrees(maps, COUNTRIES, 9.5, 46);
    assertColour(await pixelAt(maps, somaliland.x, somaliland.y), COUNTRY_EMPTY, "Somaliland");

    // The map counts every individual, whatever the find bar of the main
    // window shows.
    const find = page
      .getByRole("search", { name: "Find in the table" })
      .getByRole("searchbox", { name: "Find" });
    await find.fill("Peru");
    await grid.getByRole("gridcell", { name: "p1", exact: true }).waitFor({ state: "detached" });
    await waitForText(
      countryStatus,
      "Counting 4 of 7 individuals: 2 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    assertColour(await pixelAt(maps, madrid.x, madrid.y), COUNT_HIGH, "Spain, filtered");
    await find.fill("");
    await grid.getByRole("gridcell", { name: "p1", exact: true }).waitFor();
    await shoot(maps, engine, "maps-countries");

    // The pointer over a country names it and counts its individuals.
    await maps.mouse.move(madrid.x, madrid.y);
    const countryLabel = maps.locator('[aria-hidden="true"]').filter({ hasText: "Spain" });
    await waitForText(countryLabel, "Spain (ESP): 3 individuals");
    await maps.mouse.move(morocco.x, morocco.y);
    await waitForText(
      maps.locator('[aria-hidden="true"]').filter({ hasText: "Morocco" }),
      "Morocco: no individuals",
    );
    await shoot(maps, engine, "maps-country-label");

    // A click on a country selects its individuals alone; a Cmd-click or a
    // Ctrl-click adds another's, and takes them away when all are selected.
    // A click on a country of none changes nothing.
    await maps.mouse.click(madrid.x, madrid.y);
    await selectedAre(page, ["p1", "p2", "p6"]);
    // Spain, which holds them, has a line in the text's colour round it.
    const spainCoast = await steadyDegrees(maps, COUNTRIES, 43.45, -5);
    const peruCoast = await steadyDegrees(maps, COUNTRIES, -12, -77.15);
    await waitForColourNear(maps, spainCoast, TEXT, "the line round Spain");
    // A second click on the country whose individuals are the selection
    // clears it. The map decides a click from its own copy of the
    // selection, so each click waits for the line to show what the map
    // has: the main window's table can show a change first.
    await maps.mouse.click(madrid.x, madrid.y);
    await selectedAre(page, []);
    await waitForNoColourNear(maps, spainCoast, TEXT, "the line round Spain");
    await maps.mouse.click(madrid.x, madrid.y);
    await selectedAre(page, ["p1", "p2", "p6"]);
    await waitForColourNear(maps, spainCoast, TEXT, "the line round Spain");
    await maps.keyboard.down("ControlOrMeta");
    await maps.mouse.click(lima.x, lima.y);
    await maps.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p1", "p2", "p3", "p6"]);
    await waitForColourNear(maps, peruCoast, TEXT, "the line round Peru");
    await maps.keyboard.down("ControlOrMeta");
    await maps.mouse.click(madrid.x, madrid.y);
    await maps.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p3"]);
    await maps.mouse.click(morocco.x, morocco.y);
    // Nor does a click on the sea.
    const atlantic = await steadyDegrees(maps, COUNTRIES, 30, -40);
    await maps.mouse.click(atlantic.x, atlantic.y);
    await maps.mouse.move(lima.x, lima.y);
    await selectedAre(page, ["p3"]);
    // The line goes round Peru now, and no longer round Spain.
    await waitForColourNear(maps, peruCoast, TEXT, "the line round Peru");
    // A double click on a country leaves the selection as it was: its first
    // click selected Spain's alone, and its second would have selected none.
    // Once the window has its two changes, a Cmd-click or Ctrl-click on
    // Spain adds Spain's to p3, which it would not on either of those.
    const revision = await maps.evaluate(() => globalThis.__vavilovRevision());
    await maps.mouse.dblclick(madrid.x, madrid.y);
    await maps.waitForFunction((at) => globalThis.__vavilovRevision() >= at, revision + 2);
    await maps.keyboard.down("ControlOrMeta");
    await maps.mouse.click(madrid.x, madrid.y);
    await maps.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p1", "p2", "p3", "p6"]);
    await maps.keyboard.down("ControlOrMeta");
    await maps.mouse.click(madrid.x, madrid.y);
    await maps.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p3"]);
    await maps.mouse.move(lima.x, lima.y);
    assert.equal(
      await centreOfColour(maps, spainCoast.x, spainCoast.y, TEXT, 8),
      null,
      "a line round Spain, which holds no individual selected",
    );
    await shoot(maps, engine, "maps-country-selected");

    // With groups selected, the map counts their individuals alone, and the
    // count and the legend say whose. The classification is the column of
    // countries itself, so ESP leaves Spain alone coloured.
    await mapsPanel.getByRole("button", { name: /^ESP/ }).click();
    await waitForText(countryStatus, "Counting the 3 individuals in ESP, of 7.");
    await waitForColour(maps, lima, COUNTRY_EMPTY, "Peru, ESP alone selected");
    assertColour(await pixelAt(maps, madrid.x, madrid.y), COUNT_HIGH, "Spain, ESP selected");
    await legend.getByText("in ESP", { exact: true }).waitFor();
    assert.match(await legend.ariaSnapshot(), /From 1 to 3 individuals in ESP/);
    await shoot(maps, engine, "maps-countries-groups");
    // The unassigned individuals, added with a Cmd-click or a Ctrl-click,
    // are those with no country.
    await maps.keyboard.down("ControlOrMeta");
    await mapsPanel.getByRole("button", { name: /^Unassigned/ }).click();
    await maps.keyboard.up("ControlOrMeta");
    await waitForText(
      countryStatus,
      "Counting 3 of the 5 individuals in ESP and in no group: 2 have no country.",
    );
    // A click on the group selected alone selects it alone, and a second
    // click selects nothing: every individual is counted again.
    await mapsPanel.getByRole("button", { name: /^ESP/ }).click();
    await waitForText(countryStatus, "Counting the 3 individuals in ESP, of 7.");
    await mapsPanel.getByRole("button", { name: /^ESP/ }).click();
    await waitForText(
      countryStatus,
      "Counting 4 of 7 individuals: 2 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    await waitForColour(maps, lima, COUNT_LOW, "Peru, no group selected");
    assert.equal(await legend.getByText("in ESP", { exact: true }).count(), 0);

    // Deleting the group of Peru in the main window leaves Peru with none,
    // and undoing it gives it back its individual.
    const panel = page.getByRole("region", { name: "Groups" });
    await panel.getByRole("button", { name: /^PER/ }).click();
    await panel.getByRole("button", { name: "Delete group PER" }).click();
    await waitForText(
      countryStatus,
      "Counting 3 of 7 individuals: 3 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    await waitForColour(maps, lima, COUNTRY_EMPTY, "Peru, its group deleted");
    await choose("undo");
    await waitForText(
      countryStatus,
      "Counting 4 of 7 individuals: 2 have no country, and 1 is in French Guiana, which the map has no shape for.",
    );
    await waitForColour(maps, lima, COUNT_LOW, "Peru, its group back");

    // Map… offers the latitude and the longitude columns, and opens the map
    // of the individuals, named after them, as a second tile of the same
    // window, which comes to the front.
    await choose("map");
    const mapDialog = page.getByRole("dialog", { name: "Map" });
    await mapDialog.waitFor();
    const latitudeField = mapDialog.getByRole("combobox", { name: "Latitude column" });
    const longitudeField = mapDialog.getByRole("combobox", { name: "Longitude column" });
    assert.deepEqual(await latitudeField.locator("option").allTextContents(), ["lat"]);
    assert.deepEqual(await longitudeField.locator("option").allTextContents(), ["lon"]);
    await shoot(page, engine, "maps-dialog");
    await mapDialog.getByRole("button", { name: "Open" }).click();
    const mapTile = tile(maps, "Map of lat and lon");
    await waitForText(
      mapTile.getByRole("status"),
      "Drawing 6 of 7 individuals: 1 has no coordinates.",
    );
    assert.deepEqual(app.raised(), ["maps-1"]);
    assert.deepEqual(app.windows(), ["main", "maps-1"]);
    await assertNoGroupForms(mapsPanel);

    // Each point is drawn where its coordinates are on the map, in its
    // group's colour.
    const colours = await levelColours(backend);
    const p1 = await steadyPlace(maps, POINTS, 0);
    const p2 = await steadyPlace(maps, POINTS, 1);
    const p3 = await steadyPlace(maps, POINTS, 2);
    const atMadrid = await steadyDegrees(maps, POINTS, 40.4, -3.7);
    assert.ok(Math.hypot(atMadrid.x - p1.x, atMadrid.y - p1.y) < 0.5, "p1 is not at Madrid");
    await shoot(maps, engine, "maps-points");
    await assertDrawnAt(maps, p2, colours.get("ESP"), "p2");
    await assertDrawnAt(maps, p3, colours.get("PER"), "p3");

    // The pointer over a point shows its label, as in the 3D scatter.
    await maps.mouse.move(p3.x, p3.y);
    const pointLabel = maps.locator('[aria-hidden="true"]').filter({ hasText: "p3" });
    await pointLabel.waitFor();
    assert.match(await pointLabel.textContent(), /p3\s*origin\s*PER/);
    await shoot(maps, engine, "maps-label");

    // A click on a point selects it alone, and the individual selected is
    // drawn over p7, of no group, at the same place.
    await maps.mouse.click(p1.x, p1.y);
    await selectedAre(page, ["p1"]);
    await waitForColour(maps, p1, colours.get("ESP"), "p1 selected, over p7");

    // With the keyboard's focus on the map, an arrow pans, + zooms and
    // Home shows all the individuals again, and so does a double click.
    const mapPlot = mapTile.getByRole("application", { name: "Map of lat and lon" });
    // Where the map of countries, now half the window, has Madrid.
    const madridBefore = await steadyDegrees(maps, COUNTRIES, 40, -3.7);
    await mapPlot.focus();
    await maps.keyboard.press("ArrowRight");
    const panned = await steadyDegrees(maps, POINTS, 40.4, -3.7);
    assert.ok(panned.x < p1.x - 50, `ArrowRight did not pan: ${p1.x} to ${panned.x}`);
    // The keys act on the tile that has the focus alone: the map of
    // countries has not moved.
    const madridStill = await steadyDegrees(maps, COUNTRIES, 40, -3.7);
    assert.ok(
      Math.hypot(madridStill.x - madridBefore.x, madridStill.y - madridBefore.y) < 1,
      "the arrow moved the map of countries",
    );
    await maps.keyboard.press("Home");
    const home = await steadyDegrees(maps, POINTS, 40.4, -3.7);
    assert.ok(home.x > panned.x + 50, `Home did not pan back: ${panned.x} to ${home.x}`);
    await maps.keyboard.press("+");
    const zoomed = await steadyPlace(maps, POINTS, 2);
    assert.ok(
      Math.hypot(zoomed.x - home.x, zoomed.y - home.y) > Math.hypot(p3.x - p1.x, p3.y - p1.y),
      "+ did not zoom in",
    );
    const sea = await steadyDegrees(maps, POINTS, 20, -40);
    await maps.mouse.dblclick(sea.x, sea.y);
    const framed = await steadyDegrees(maps, POINTS, 40.4, -3.7);
    assert.ok(Math.hypot(framed.x - home.x, framed.y - home.y) < 1, "a double click did not frame");
    await selectedAre(page, ["p1"]);
    await shoot(maps, engine, "maps-two");

    // A second map of the individuals is a third tile. + pressed in the
    // panel arms the lasso of both maps, and shows pressed in the main
    // window too.
    await choose("map");
    await mapDialog.waitFor();
    await mapDialog.getByRole("button", { name: "Open" }).click();
    await maps.waitForFunction(
      () => globalThis.document.querySelectorAll("[data-tile]").length === 3,
    );
    await waitForText(
      tile(maps, "Map of lat and lon (2)").getByRole("status"),
      "Drawing 6 of 7 individuals",
    );
    await mapsPanel.getByRole("button", { name: /^ESP/ }).click();
    await mapsPanel.getByRole("button", { name: "Remove selected from ESP" }).waitFor();
    await mapsPanel.getByRole("button", { name: "Add selected to ESP", exact: true }).click();
    await mapsPanel.getByRole("button", { name: "Add selected to ESP", pressed: true }).waitFor();
    await panel.getByRole("button", { name: "Add selected to ESP", pressed: true }).waitFor();
    // The maps' cursor shows the lasso armed, once the message of the
    // button pressed has come back: a drag before it pans.
    await maps.locator(".plot-lasso-armed").first().waitFor();
    // A lasso stays in its tile, and one drawn in the third drops the one
    // waiting in the second: Enter applies the last alone, putting p4, of
    // no group, in Spain, and not p3.
    await lassoAround(maps, await steadyPlace(maps, POINTS, 2));
    await lassoAround(maps, await steadyPlace(maps, OTHER_POINTS, 3));
    await shoot(maps, engine, "maps-lasso");
    await maps.keyboard.press("Enter");
    await originSays(grid, "p4", "ESP");
    await originSays(grid, "p3", "PER");
    // A lasso that waits goes when the map changes size, since it no
    // longer fits the points (issue #8).
    await lassoAround(maps, await steadyPlace(maps, POINTS, 2));
    await maps.waitForFunction(lassoDrawn, true);
    const size = maps.viewportSize();
    await maps.setViewportSize({ width: size.width, height: size.height - 40 });
    await maps.waitForFunction(lassoDrawn, false);
    await maps.setViewportSize(size);
    // A lasso drawn around p3 in the second map, applied with Enter, puts
    // it in Spain.
    await lassoAround(maps, await steadyPlace(maps, POINTS, 2));
    await maps.keyboard.press("Enter");
    await originSays(grid, "p3", "ESP");
    // Escape releases +, in every window, and keeps the selection; a second
    // Escape clears it.
    await maps.keyboard.press("Escape");
    await panel.getByRole("button", { name: "Add selected to ESP", pressed: false }).waitFor();
    await mapsPanel.getByRole("button", { name: "Add selected to ESP", pressed: false }).waitFor();
    await selectedAre(page, ["p1"]);
    await maps.keyboard.press("Escape");
    await selectedAre(page, []);
    // The map of countries counts p3 and p4 in Spain now: Spain holds 5,
    // and Peru none.
    await legend.filter({ hasText: /No individuals\s*1\s*5/ }).waitFor();

    // A tile's button closes it alone; the last tile closed gives the focus
    // to the tile before it.
    await maps.getByRole("button", { name: "Close Map of lat and lon (2)", exact: true }).click();
    await maps.waitForFunction(
      () => globalThis.document.querySelectorAll("[data-tile]").length === 2,
    );
    await maps.waitForFunction(
      (id) => globalThis.document.activeElement?.closest("[data-tile]")?.dataset.tile === id,
      String(POINTS),
    );
    // With two tiles, the map of countries has half the window, where Peru
    // is large enough to find a pixel of: it holds none now.
    const peru = await steadyDegrees(maps, COUNTRIES, -10, -75);
    await waitForColour(maps, peru, COUNTRY_EMPTY, "Peru with none");

    // A change of role that leaves a map a column it cannot show closes its
    // tile: a latitude made a plain number closes the map of the
    // individuals, and the window keeps the map of countries; the
    // countries made a category close the last, and the window with it. A
    // map closed under the pointer takes the label of its point with it.
    const hovered = await steadyPlace(maps, POINTS, 2);
    await maps.mouse.move(hovered.x, hovered.y);
    await pointLabel.waitFor();
    await grid.getByRole("combobox", { name: "Role of lat", exact: true }).selectOption("number");
    await maps.waitForFunction(
      () => globalThis.document.querySelectorAll("[data-tile]").length === 1,
    );
    await pointLabel.waitFor({ state: "hidden" });
    await countriesTile.getByRole("application", { name: "Map of countries in origin" }).waitFor();
    // Waited for before the change, which can close the page before the
    // select's own promise resolves.
    const closed = maps.waitForEvent("close");
    await grid
      .getByRole("combobox", { name: "Role of origin", exact: true })
      .selectOption("category");
    await closed;
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

/** The tile named `name`, by its title. */
function tile(page, name) {
  return page.getByRole("group", { name, exact: true });
}

/**
 * The place of `latitude`, `longitude` on the map of the widget `id`, in
 * the window `page`, once the map has stopped moving after its framing.
 */
async function steadyDegrees(page, id, latitude, longitude) {
  return steady(page, () =>
    page.evaluate(
      ([widget, lat, lon]) =>
        globalThis.__vavilovPlotOf?.(widget)?.placeOfDegrees(lat, lon) ?? null,
      [id, latitude, longitude],
    ),
  );
}

/**
 * The place of the point of `row` on the map of the widget `id`, in the
 * window `page`, once the map has stopped moving.
 */
async function steadyPlace(page, id, row) {
  return steady(page, () =>
    page.evaluate(
      ([widget, r]) => globalThis.__vavilovPlotOf?.(widget)?.placeOf(r) ?? null,
      [id, row],
    ),
  );
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

/** Whether the canvas of a lasso, of any tile, holds a pixel drawn, as `drawn` says it should. */
function lassoDrawn(drawn) {
  const any = [...globalThis.document.querySelectorAll("canvas.plot-lasso")].some((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  });
  return any === drawn;
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
