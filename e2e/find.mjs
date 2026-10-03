// The find bar above the table and the information bar below it, against
// the real core, in each engine: a text found in any column or in one, a
// whole cell, the rows that don't match, a number by the region's decimal
// mark, a country by its ISO names, a shift-click over a filtered table,
// "Select shown rows", the count of the rows, Undo and Redo in the field, by the keyboard and by the
// menu, a load clearing the filter, and a filtered table of 250 rows
// scrolled past its first page. Screenshots, light and dark, land in
// e2e/output/.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

/**
 * Six plants: 1 height, decimal numbers; 2 origin, a category, active;
 * 3 note, text.
 */
const PLANTS = {
  header: "IndividualID",
  names: ["p1", "p2", "p3", "p4", "p5", "p6"],
  columns: [
    { name: "height", numeric: [1.5, 2, null, 12.5, 3.25, 1] },
    {
      name: "origin",
      levels: [
        ["Spain", [230, 159, 0]],
        ["Peru", [86, 180, 233]],
      ],
      codes: [0, 1, null, 0, 1, 0],
    },
    { name: "note", text: ["Spain's best", null, "tall", "tall", null, "short"] },
  ],
  activeClassification: 2,
};

/** The cells of each plant, as the table draws them with the region's comma. */
const CELLS = {
  p1: ["p1", "1,5", "Spain", "Spain's best"],
  p2: ["p2", "2", "Peru", "missing"],
  p3: ["p3", "missing", "missing", "tall"],
  p4: ["p4", "12,5", "Spain", "tall"],
  p5: ["p5", "3,25", "Peru", "missing"],
  p6: ["p6", "1", "Spain", "short"],
};
const ALL = ["p1", "p2", "p3", "p4", "p5", "p6"];
/** The same cells once origin is a column of countries, each drawn as its code. */
const COUNTRY_CELLS = Object.fromEntries(
  Object.entries(CELLS).map(([name, [id, height, origin, note]]) => [
    name,
    [id, height, { Spain: "ESP", Peru: "PER" }[origin] ?? origin, note],
  ]),
);

/**
 * 250 plants, r000 to r249: 1 height, row + 0.5; 2 note, "keep" for the
 * rows whose number ends in 0, 1, 2, 5, 6 or 7, 150 of them, "drop" for
 * the other 100.
 */
const MANY = {
  header: "IndividualID",
  names: Array.from({ length: 250 }, (_, row) => `r${String(row).padStart(3, "0")}`),
  columns: [
    { name: "height", numeric: Array.from({ length: 250 }, (_, row) => row + 0.5) },
    {
      name: "note",
      text: Array.from({ length: 250 }, (_, row) => (row % 5 < 3 ? "keep" : "drop")),
    },
  ],
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({
    engine,
    backend: true,
    viewport: { width: 1000, height: 520 },
    locale: "es-ES",
    region: ",",
  });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    const grid = page.getByRole("grid", { name: "Individuals" });
    await rowsShown(grid, ALL);
    const find = page.getByRole("search", { name: "Find in the table" });
    const field = find.getByRole("searchbox", { name: "Find" });
    const column = find.getByRole("combobox", { name: "Column" });
    const whole = find.getByRole("checkbox", { name: "Whole cell" });
    const notMatching = find.getByRole("checkbox", { name: "Show rows that don't match" });
    await countSays(page, "6 individuals");

    // In any column, case ignored: Spain is in origin and in a note.
    await field.fill("SPAIN");
    await rowsShown(grid, ["p1", "p4", "p6"]);
    await countSays(page, "Showing 3 of 6 individuals");
    await shoot(page, engine, "find-any");

    // In one column; a missing cell never matches, so the rows that don't
    // match show p3, whose origin is missing.
    await column.selectOption({ label: "origin" });
    await rowsShown(grid, ["p1", "p4", "p6"]);
    await notMatching.check();
    await rowsShown(grid, ["p2", "p3", "p5"]);
    await notMatching.uncheck();

    // A whole cell: "spa" is part of Spain, not the whole of it.
    await field.fill("spa");
    await rowsShown(grid, ["p1", "p4", "p6"]);
    await whole.check();
    await rowsShown(grid, []);
    await countSays(page, "Showing 0 of 6 individuals");
    await whole.uncheck();

    // A number by the text the table shows, with the region's comma.
    await column.selectOption({ label: "height" });
    await field.fill("1,5");
    await rowsShown(grid, ["p1"]);
    await field.fill("2,5");
    await rowsShown(grid, ["p4"]);

    // A country by its ISO name, once origin is a country.
    await field.fill("");
    await rowsShown(grid, ALL);
    await grid
      .getByRole("combobox", { name: "Role of origin", exact: true })
      .selectOption("country");
    await column.selectOption({ label: "origin" });
    await field.fill("Republic of Peru");
    await rowsShown(grid, ["p2", "p5"], COUNTRY_CELLS);

    // A shift-click over the rows shown selects none the filter hides.
    await rowNamed(grid, "p2").click();
    await rowNamed(grid, "p5").click({ modifiers: ["Shift"] });
    await countSays(page, "Showing 2 of 6 individuals · 2 selected");
    await field.fill("");
    await rowsShown(grid, ALL, COUNTRY_CELLS);
    assert.deepEqual(await selectedRows(grid), ["p2", "p5"]);
    await shoot(page, engine, "find-selected");

    // "Select shown rows" makes the rows shown the selection, in place of
    // the one there was, and with no text, every row.
    const selectShown = find.getByRole("button", { name: "Select shown rows" });
    await column.selectOption({ label: "note" });
    await field.fill("tall");
    await rowsShown(grid, ["p3", "p4"], COUNTRY_CELLS);
    await selectShown.click();
    await countSays(page, "Showing 2 of 6 individuals · 2 selected");
    await field.fill("");
    await rowsShown(grid, ALL, COUNTRY_CELLS);
    assert.deepEqual(await selectedRows(grid), ["p3", "p4"]);
    await selectShown.click();
    await countSays(page, "6 individuals · 6 selected");
    assert.deepEqual(await selectedRows(grid), ALL);
    await rowNamed(grid, "p2").click();
    await rowNamed(grid, "p5").click({ modifiers: ["Shift"] });
    await column.selectOption({ label: "origin" });
    await countSays(page, "6 individuals · 4 selected");

    // Undo and Redo pressed in the field take back its typing and give it
    // back, and the rows follow the text: WebKit takes back the word,
    // Chromium a letter (docs/design.md, section 10).
    // The window takes each key from the menu, which in the app would undo
    // an edit of the table, or, greyed out, keep the key from the field.
    await page.evaluate(() => {
      globalThis.__undoKeysTaken = [];
      globalThis.addEventListener("keydown", (event) => {
        if (event.key.toLowerCase() === "z")
          globalThis.__undoKeysTaken.push(event.defaultPrevented);
      });
    });
    await column.selectOption({ label: "Any column" });
    await field.click();
    await page.keyboard.type("12");
    await rowsShown(grid, ["p4"], COUNTRY_CELLS);
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForFunction((element) => element.value !== "12", await field.elementHandle());
    const undone = await field.inputValue();
    const rowsOfText = { 1: ["p1", "p4", "p6"], "": ALL };
    assert.ok(undone in rowsOfText, `the field after Undo: ${JSON.stringify(undone)}`);
    await rowsShown(grid, rowsOfText[undone], COUNTRY_CELLS);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.waitForFunction((element) => element.value === "12", await field.elementHandle());
    await rowsShown(grid, ["p4"], COUNTRY_CELLS);
    assert.deepEqual(await page.evaluate(() => globalThis.__undoKeysTaken), [true, true]);

    // Edit > Undo in the menu, with the focus in the field, undoes its
    // typing, not the change of origin to a country.
    await field.fill("");
    await rowsShown(grid, ALL, COUNTRY_CELLS);
    await page.keyboard.type("tall");
    await rowsShown(grid, ["p3", "p4"], COUNTRY_CELLS);
    const sent = await backend.send({ command: "e2e:action", action: "undo" });
    assert.equal(sent.ok, null, JSON.stringify(sent));
    await page.waitForFunction((element) => element.value !== "tall", await field.elementHandle());
    assert.equal(
      await grid.getByRole("combobox", { name: "Role of origin", exact: true }).inputValue(),
      "country",
    );

    // A load clears the filter, and the field.
    await field.fill("tall");
    await rowsShown(grid, ["p3", "p4"], COUNTRY_CELLS);
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    await rowsShown(grid, ALL);
    assert.equal(await field.inputValue(), "");
    assert.equal(await column.inputValue(), "any");

    // A filter of 150 rows of 250, scrolled past its first page of 100:
    // position 120 is the 201st plant, r200.
    assert.equal((await backend.send({ command: "e2e:load", table: MANY })).ok, null);
    await field.fill("keep");
    await countSays(page, "Showing 150 of 250 individuals");
    await scrollTo(page, 120);
    await rowDrawn(page, 120, ["r200", "200,5", "keep"]);
    await shoot(page, engine, "find-scrolled");
    // The 100 rows that don't match, while the scroll was past them: the
    // last, position 99, is r249.
    await notMatching.check();
    await countSays(page, "Showing 100 of 250 individuals");
    await scrollTo(page, 99);
    await rowDrawn(page, 99, ["r249", "249,5", "drop"]);
    await rowDrawn(page, 98, ["r248", "248,5", "drop"]);

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e find, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/** The cells of the rows drawn, in order, skipping the header; `null` while a row waits for its page. */
function cellsDrawn() {
  const rows = [...globalThis.document.querySelectorAll('[role="row"][aria-rowindex]')].filter(
    (row) => row.getAttribute("aria-rowindex") !== "1",
  );
  if (rows.some((row) => row.getAttribute("aria-busy") === "true")) {
    return null;
  }
  return rows.map((row) =>
    [...row.querySelectorAll('[role="gridcell"]')].map((cell) => cell.textContent.trim()),
  );
}

/** Waits until the rows drawn are the plants named, in order, each with every cell of `cells`. */
async function rowsShown(grid, names, cells = CELLS) {
  const page = grid.page();
  const expected = JSON.stringify(names.map((name) => cells[name]));
  try {
    await page.waitForFunction((want) => {
      const rows = [...globalThis.document.querySelectorAll('[role="row"][aria-rowindex]')];
      const body = rows.filter((row) => row.getAttribute("aria-rowindex") !== "1");
      if (body.some((row) => row.getAttribute("aria-busy") === "true")) {
        return false;
      }
      const got = body.map((row) =>
        [...row.querySelectorAll('[role="gridcell"]')].map((cell) => cell.textContent.trim()),
      );
      return JSON.stringify(got) === want;
    }, expected);
  } catch (error) {
    const got = JSON.stringify(await page.evaluate(cellsDrawn));
    throw new Error(`rows drawn ${got}, not ${expected}`, { cause: error });
  }
}

/** Waits until the row at `position` among those shown is drawn with `cells`. */
async function rowDrawn(page, position, cells) {
  await page.waitForFunction(
    ([index, want]) => {
      const row = globalThis.document.querySelector(`[role="row"][aria-rowindex="${index}"]`);
      if (row === null || row.getAttribute("aria-busy") === "true") {
        return false;
      }
      const got = [...row.querySelectorAll('[role="gridcell"]')].map((cell) =>
        cell.textContent.trim(),
      );
      return JSON.stringify(got) === want;
    },
    [String(position + 2), JSON.stringify(cells)],
  );
}

/** Scrolls the table so that the row at `position` is at the top. */
async function scrollTo(page, position) {
  await page.evaluate((at) => {
    const height = globalThis.document.querySelector("[data-probe]").getBoundingClientRect().height;
    globalThis.document.querySelector("[data-scroller]").scrollTop = at * height;
  }, position);
}

/**
 * Waits until the count told to a screen reader, once it stopped changing,
 * is `text`, and checks that the bar shows it too.
 */
async function countSays(page, text) {
  await page
    .getByRole("status")
    .filter({ hasText: new RegExp(`^${escaped(text)}$`) })
    .waitFor();
  assert.equal(await page.getByText(text, { exact: true }).count(), 2);
}

/** `text` with the characters a regular expression gives a meaning escaped. */
function escaped(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The names of the rows drawn as selected. */
async function selectedRows(grid) {
  return grid
    .page()
    .evaluate(() =>
      [...globalThis.document.querySelectorAll('[role="row"][aria-selected="true"]')].map((row) =>
        row.querySelector('[role="gridcell"]')?.textContent?.trim(),
      ),
    );
}

/** The row whose first cell is `name`. */
function rowNamed(grid, name) {
  return grid
    .getByRole("row")
    .filter({ has: grid.page().getByRole("gridcell", { name, exact: true }) });
}

/** A screenshot in the light and in the dark appearance, with reduced motion. */
async function shoot(page, engine, name) {
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.screenshot({ path: `${OUT}${name}-${colorScheme}-${engine}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}
