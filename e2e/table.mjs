// The table of the main window against the real core, in each engine: the
// columns and the cells of the first rows, a scroll to rows of a page not
// yet fetched, a click and a shift-click that select rows, and a lasso made
// elsewhere showing in a cell. Screenshots, light and dark, land in
// e2e/output/.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

const NUM_PLANTS = 300;
const indexes = [...Array(NUM_PLANTS).keys()];

/**
 * 300 plants, p1 to p300: 1 height, every seventh missing; 2 origin (Spain,
 * Peru), active, every fifth unassigned; 3 seeds; 4 fertile; 5 note.
 */
const PLANTS = {
  header: "accession",
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
      text: indexes.map((i) => (i % 4 === 0 ? "landrace" : i % 4 === 1 ? "" : null)),
    },
  ],
  activeClassification: 2,
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({
    engine,
    backend: true,
    viewport: { width: 1100, height: 560 },
    // Spanish, so that the decimal mark is a comma.
    locale: "es-ES",
  });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);

    const grid = page.getByRole("grid", { name: "Individuals" });
    await grid.waitFor();
    assert.equal(await grid.getAttribute("aria-rowcount"), String(NUM_PLANTS + 1));
    assert.deepEqual(await grid.getByRole("columnheader").allTextContents().then(trim), [
      "accession",
      "height",
      "origin",
      "seeds",
      "fertile",
      "note",
    ]);
    // Row 4, p4: its height is missing, said "missing" to a screen reader.
    const p4 = rowNamed(grid, "p4");
    await p4.waitFor();
    assert.deepEqual(await cells(p4), ["p4", "missing", "Peru", "9", "FALSE", "missing"]);
    // Row 2, p2: a height with a decimal comma, origin Peru, an empty note.
    assert.deepEqual(await cells(rowNamed(grid, "p2")), ["p2", "100,25", "Peru", "3", "TRUE", ""]);
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

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e table, ${engine}: passed`);
  } finally {
    await app.close();
  }
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
