// The table of the main window against the real core, in each engine: the
// columns and the cells of the first rows, the roles each column offers, a
// scroll to rows of a page not yet fetched, a click and a shift-click that
// select rows, a lasso made elsewhere showing in a cell, and a change of
// role that the populations panel follows. Screenshots, light and dark, land in
// e2e/output/.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

const NUM_PLANTS = 300;
const indexes = [...Array(NUM_PLANTS).keys()];

/**
 * 300 plants, p1 to p300: 1 height, every seventh missing; 2 origin (Spain,
 * Peru), a category, active, every fifth unassigned; 3 seeds; 4
 * fertile, a category of yes or no; 5 note.
 */
const PLANTS = {
  header: "IndividualID",
  names: indexes.map((i) => `p${String(i + 1)}`),
  columns: [
    { name: "height", numeric: indexes.map((i) => (i % 7 === 3 ? null : 100 + i / 4)) },
    {
      name: "origin",
      levels: [
        ["Spain", [230, 159, 0]],
        ["Peru", [86, 180, 233]],
      ],
      codes: indexes.map((i) => (i % 5 === 4 ? null : i % 2)),
    },
    { name: "seeds", integer: indexes.map((i) => (i % 11 === 0 ? null : 3 * i)) },
    { name: "fertile", boolean: indexes.map((i) => i % 3 !== 0) },
    {
      name: "note",
      text: indexes.map((i) => (i % 4 === 0 ? "landrace" : i % 4 === 1 ? "cultivar" : null)),
    },
  ],
  activeClassification: 2,
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({
    engine,
    backend: true,
    viewport: { width: 1100, height: 560 },
    // English as the language and a region of the decimal comma, as a
    // Spanish Mac in English: the table writes the region's comma.
    locale: "en-US",
    region: ",",
  });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);

    const grid = page.getByRole("grid", { name: "Individuals" });
    await grid.waitFor();
    assert.equal(await grid.getAttribute("aria-rowcount"), String(NUM_PLANTS + 1));
    assert.deepEqual(await headerNames(grid), [
      "IndividualID",
      "height",
      "origin",
      "seeds",
      "fertile",
      "note",
    ]);
    // Each column but the first has the dropdown of the roles it can take.
    // height, from 100 to 174.75, fits a longitude but not a latitude.
    assert.deepEqual(await roleOptions(grid, "height"), ["Number", "Longitude", "Category"]);
    // origin, Spain and Peru, names countries.
    assert.deepEqual(await roleOptions(grid, "origin"), ["Category", "Country", "Text"]);
    assert.deepEqual(await roleOptions(grid, "fertile"), ["Category"]);
    assert.equal(await roleOf(grid, "seeds").inputValue(), "number");
    assert.equal(await grid.getByRole("combobox", { name: "Role of IndividualID" }).count(), 0);
    // Row 4, p4: its height is missing, said "missing" to a screen reader.
    const p4 = rowNamed(grid, "p4");
    await p4.waitFor();
    assert.deepEqual(await cells(p4), ["p4", "missing", "Peru", "9", "FALSE", "missing"]);
    // Row 2, p2: a height with a decimal comma, origin Peru, an empty note.
    assert.deepEqual(await cells(rowNamed(grid, "p2")), [
      "p2",
      "100,25",
      "Peru",
      "3",
      "TRUE",
      "cultivar",
    ]);
    assert.deepEqual(await cells(rowNamed(grid, "p5")), [
      "p5",
      "101",
      "missing",
      "12",
      "TRUE",
      "landrace",
    ]);
    // Only the rows on screen and a margin are drawn, not the 300.
    const drawn = await grid.getByRole("row").count();
    assert.ok(drawn > 10 && drawn < 100, `${String(drawn)} rows drawn`);
    await shoot(page, engine, "table-top");

    // A click selects p3; a shift-click on p6 the rows from p3 to p6.
    await rowNamed(grid, "p3").click();
    await waitSelected(grid, ["p3"]);
    await rowNamed(grid, "p6").click({ modifiers: ["Shift"] });
    await waitSelected(grid, ["p3", "p4", "p5", "p6"]);
    await shoot(page, engine, "table-selected");

    // A lasso made elsewhere, as in another window: p1 to p3 into Spain.
    const selected = await backend.send({
      window: "main",
      command: "select_population",
      json: { column: 2, selected: { population: 0 }, basedOn: 3 },
    });
    assert.equal(selected.ok, null, JSON.stringify(selected));
    const lasso = await backend.send({
      window: "main",
      command: "assign_rows",
      raw: [0b0111, ...Array(37).fill(0)],
      headers: { column: "2", target: "0", "based-on": "4" },
    });
    assert.equal(lasso.ok, null, JSON.stringify(lasso));
    await rowNamed(grid, "p2").getByRole("gridcell", { name: "Spain" }).waitFor();

    // Every category can be chosen in the panel, fertile as well as origin.
    const panel = page.getByRole("region", { name: "Populations" });
    const classification = panel.getByRole("combobox", { name: "Classification column" });
    assert.deepEqual(await classification.locator("option").allTextContents().then(trim), [
      "None",
      "origin",
      "fertile",
    ]);
    await shoot(page, engine, "table-roles");

    // origin made text: its codes go from the window's copy before the new
    // description arrives, and the table must not draw from the old one.
    // origin is the classification column, so making it text asks first;
    // Escape keeps it a category, and gives the focus back to its dropdown.
    await roleOf(grid, "origin").focus();
    await roleOf(grid, "origin").selectOption("text");
    const question = page.getByRole("dialog", { name: "Make “origin” text?" });
    await question.waitFor();
    await shoot(page, engine, "table-confirm");
    await page.keyboard.press("Escape");
    await question.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => globalThis.document.activeElement?.getAttribute("aria-label") === "Role of origin",
    );
    await page.waitForFunction(
      (select) => select.value === "category",
      await roleOf(grid, "origin").elementHandle(),
    );
    assert.equal(await classification.inputValue(), "2");
    // Asked again, and made text.
    await roleOf(grid, "origin").selectOption("text");
    await question.getByRole("button", { name: "Make it text" }).click();
    // Text cannot be the classification: origin leaves the panel once the
    // new description has arrived, and nothing is active.
    await classification.locator("option", { hasText: "origin" }).waitFor({ state: "detached" });
    assert.equal(await classification.inputValue(), "");
    // p2's origin, Spain, is now drawn as text, from a page fetched again.
    await rowNamed(grid, "p2").getByRole("gridcell", { name: "Spain" }).waitFor();
    assert.equal(await roleOf(grid, "origin").inputValue(), "text");
    assert.deepEqual(errors, [], "no page errors after origin was made text");

    // origin made a country: each value is its code, and the panel can
    // choose it again.
    await roleOf(grid, "origin").selectOption("country");
    await rowNamed(grid, "p2").getByRole("gridcell", { name: "ESP" }).waitFor();
    await classification.locator("option", { hasText: "origin" }).waitFor({ state: "attached" });
    await classification.selectOption({ label: "origin" });
    await panel.getByRole("button", { name: /^ESP/ }).waitFor();
    await shoot(page, engine, "table-countries");

    // A scroll to the end draws the last rows, from pages fetched then.
    await page.locator("[data-scroller]").evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    const last = rowNamed(grid, "p300");
    await last.waitFor();
    await last.getByRole("gridcell", { name: "p300" }).waitFor();
    assert.deepEqual(await cells(last), ["p300", "174,75", "missing", "897", "TRUE", "missing"]);
    assert.equal(await rowNamed(grid, "p1").count(), 0, "the first rows are no longer drawn");
    await shoot(page, engine, "table-end");

    // In a narrow window scrolled to its last column, Shift+Tab goes back
    // through the role dropdowns, and none is hidden under the column of
    // the names, which stays on the left.
    await page.setViewportSize({ width: 640, height: 500 });
    await page.locator("[data-scroller]").evaluate((scroller) => {
      scroller.scrollLeft = scroller.scrollWidth;
    });
    await roleOf(grid, "note").focus();
    for (const name of ["fertile", "seeds", "origin", "height"]) {
      await page.keyboard.press("Shift+Tab");
      const shown = await page.evaluate(() => {
        const focused = globalThis.document.activeElement;
        const box = focused.getBoundingClientRect();
        const top = globalThis.document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return { label: focused.getAttribute("aria-label"), seen: focused.contains(top) };
      });
      assert.deepEqual(shown, { label: `Role of ${name}`, seen: true }, `Role of ${name} in view`);
    }

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e table, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/** The names of the columns, as their headers show them. */
function headerNames(grid) {
  return grid.evaluate((element) =>
    [...element.querySelectorAll('[role="columnheader"]')].map(
      (header) => header.querySelector("span")?.textContent?.trim() ?? "",
    ),
  );
}

/** The dropdown of the role of the column `name`. */
function roleOf(grid, name) {
  return grid.getByRole("combobox", { name: `Role of ${name}`, exact: true });
}

/** The roles the dropdown of the column `name` offers. */
async function roleOptions(grid, name) {
  return trim(await roleOf(grid, name).locator("option").allTextContents());
}

/** The row whose first cell is `name`. */
function rowNamed(grid, name) {
  return grid
    .getByRole("row")
    .filter({ has: grid.page().getByRole("gridcell", { name, exact: true }) });
}

/** The texts of the cells of a row, as a screen reader names them. */
async function cells(row) {
  return trim(await row.getByRole("gridcell").allTextContents());
}

/** Waits until the rows selected among those drawn are those named. */
async function waitSelected(grid, names) {
  await grid.page().waitForFunction((expected) => {
    const rows = [...globalThis.document.querySelectorAll('[role="row"][aria-selected="true"]')];
    const got = rows.map((row) => row.querySelector('[role="gridcell"]')?.textContent?.trim());
    return JSON.stringify(got) === JSON.stringify(expected);
  }, names);
}

/** The texts of elements, with their runs of white space made one space. */
function trim(texts) {
  return texts.map((text) => text.replace(/\s+/g, " ").trim());
}

/**
 * A screenshot of the window in the light and in the dark appearance, with
 * reduced motion, so that no transition is caught halfway.
 */
async function shoot(page, engine, name) {
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.screenshot({ path: `${OUT}${name}-${colorScheme}-${engine}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}
