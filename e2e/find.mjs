// The find bar above the table and the information bar below it, against
// the real core, in each engine: a text found in any column or in one, a
// whole cell, the rows that don't match, a number by the region's decimal
// mark, a country by its ISO names, a shift-click over a filtered table, the
// count of the rows, Undo in the field undoing its typing, and a load
// clearing the filter. Screenshots, light and dark, land in e2e/output/.
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
    await rowsShown(grid, ["p1", "p2", "p3", "p4", "p5", "p6"]);
    const find = page.getByRole("search", { name: "Find in the table" });
    const field = find.getByRole("searchbox", { name: "Find" });
    const column = find.getByRole("combobox", { name: "Column" });
    const whole = find.getByRole("checkbox", { name: "Whole cell" });
    const notMatching = find.getByRole("checkbox", { name: "Show rows that don't match" });
    const count = page.getByRole("status").filter({ hasText: "individuals" });
    assert.equal(await count.textContent(), "6 individuals");

    // In any column, case ignored: Spain is in origin and in a note.
    await field.fill("SPAIN");
    await rowsShown(grid, ["p1", "p4", "p6"]);
    assert.equal(await count.textContent(), "Showing 3 of 6 individuals");
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
    assert.equal(await count.textContent(), "Showing 0 of 6 individuals");
    await whole.uncheck();

    // A number by the text the table shows, with the region's comma.
    await column.selectOption({ label: "height" });
    await field.fill("1,5");
    await rowsShown(grid, ["p1"]);
    await field.fill("2,5");
    await rowsShown(grid, ["p4"]);

    // A country by its ISO name, once origin is a country.
    await field.fill("");
    await rowsShown(grid, ["p1", "p2", "p3", "p4", "p5", "p6"]);
    await grid
      .getByRole("combobox", { name: "Role of origin", exact: true })
      .selectOption("country");
    await column.selectOption({ label: "origin" });
    await field.fill("Republic of Peru");
    await rowsShown(grid, ["p2", "p5"]);

    // A shift-click over the rows shown selects none the filter hides.
    await rowNamed(grid, "p2").click();
    await rowNamed(grid, "p5").click({ modifiers: ["Shift"] });
    await count.filter({ hasText: "2 selected" }).waitFor();
    assert.equal(await count.textContent(), "Showing 2 of 6 individuals · 2 selected");
    await field.fill("");
    await rowsShown(grid, ["p1", "p2", "p3", "p4", "p5", "p6"]);
    assert.deepEqual(await selectedRows(grid), ["p2", "p5"]);
    await shoot(page, engine, "find-selected");

    // Undo with the focus in the field undoes its typing, not the change
    // of origin to a country.
    await column.selectOption({ label: "Any column" });
    await field.click();
    await page.keyboard.type("tall");
    await rowsShown(grid, ["p3", "p4"]);
    const sent = await backend.send({ command: "e2e:action", action: "undo" });
    assert.equal(sent.ok, null, JSON.stringify(sent));
    await page.waitForFunction((element) => element.value !== "tall", await field.elementHandle());
    assert.equal(
      await grid.getByRole("combobox", { name: "Role of origin", exact: true }).inputValue(),
      "country",
    );

    // A load clears the filter, and the field.
    await field.fill("tall");
    await rowsShown(grid, ["p3", "p4"]);
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    await rowsShown(grid, ["p1", "p2", "p3", "p4", "p5", "p6"]);
    assert.equal(await field.inputValue(), "");
    assert.equal(await column.inputValue(), "any");

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e find, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/** Waits until the rows drawn, by their names, are `names`, each with its cells. */
async function rowsShown(grid, names) {
  await grid.page().waitForFunction((expected) => {
    const rows = [...document.querySelectorAll('[role="row"][aria-rowindex]')].filter(
      (row) => row.getAttribute("aria-rowindex") !== "1",
    );
    if (rows.some((row) => row.getAttribute("aria-busy") === "true")) {
      return false;
    }
    const got = rows.map((row) => row.querySelector('[role="gridcell"]')?.textContent?.trim());
    return JSON.stringify(got) === JSON.stringify(expected);
  }, names);
}

/** The names of the rows drawn as selected. */
async function selectedRows(grid) {
  return grid
    .page()
    .evaluate(() =>
      [...document.querySelectorAll('[role="row"][aria-selected="true"]')].map((row) =>
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
