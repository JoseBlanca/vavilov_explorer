// Editing the cells of the table against the real core, in each engine: a
// double-click opens a cell with the text it shows, Enter or leaving the
// cell applies what is typed and Escape gives it up; a value that does not fit is refused, in
// the information bar, and the cell keeps its value; "Apply to all selected
// rows" gives the value to every selected row in one edit, which one undo
// reverts, the double-click keeping the selection; a click on a row of a
// selection of several narrows it once no second click follows; a
// category suggests its values; an ID is edited alone and never twice; the
// keyboard moves on the cells, opens one with Enter, selects with Space
// and extends the selection with Shift and a move up or down; the checkbox
// is offered for a selection of several rows only, beside the cell.
// Screenshots, light and dark, land in e2e/output/.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

/**
 * Four plants: 1 height, decimal numbers; 2 origin, a category, active;
 * 3 seeds, whole numbers.
 */
const PLANTS = {
  header: "IndividualID",
  names: ["p1", "p2", "p3", "p4"],
  columns: [
    { name: "height", numeric: [1.5, 2, null, 12.5] },
    {
      name: "origin",
      levels: [
        ["Spain", [230, 159, 0]],
        ["Peru", [86, 180, 233]],
      ],
      codes: [0, 1, null, 0],
    },
    { name: "seeds", integer: [10, 12, null, 7] },
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
    await rowsShown(page, [
      ["p1", "1,5", "Spain", "10"],
      ["p2", "2", "Peru", "12"],
      ["p3", "missing", "missing", "missing"],
      ["p4", "12,5", "Spain", "7"],
    ]);

    // A double-click opens the cell with the text it shows, all of it
    // selected, so that typing replaces it; Enter applies it.
    await cell(grid, "p2", 1).dblclick();
    const height = grid.getByRole("textbox", { name: "height of p2" });
    await height.waitFor();
    assert.equal(await height.inputValue(), "2");
    assert.equal(
      await height.evaluate((field) => [field.selectionStart, field.selectionEnd].join()),
      "0,1",
    );
    // With no selection of several rows, no checkbox is offered.
    assert.equal(
      await grid.getByRole("checkbox", { name: "Apply to all selected rows" }).count(),
      0,
    );
    await shoot(page, engine, "cells-editing");
    await page.keyboard.type("2,75");
    await page.keyboard.press("Enter");
    await height.waitFor({ state: "detached" });
    await cellSays(page, "p2", 1, "2,75");
    await focusOnGrid(page);

    // Escape gives the cell back as it was.
    await cell(grid, "p4", 1).dblclick();
    await page.keyboard.type("99");
    await page.keyboard.press("Escape");
    await grid.getByRole("textbox").waitFor({ state: "detached" });
    await cellSays(page, "p4", 1, "12,5");
    await focusOnGrid(page);

    // Leaving the cell for another place applies what was typed, and the
    // focus stays where it went.
    await cell(grid, "p4", 1).dblclick();
    await page.keyboard.type("13");
    const find = page.getByRole("searchbox", { name: "Find" });
    await find.click();
    await grid.getByRole("textbox").waitFor({ state: "detached" });
    await cellSays(page, "p4", 1, "13");
    assert.equal(await find.evaluate((field) => field === globalThis.document.activeElement), true);

    // A value that does not fit the column is refused: the bar says why,
    // and the cell keeps its value.
    await cell(grid, "p1", 3).dblclick();
    await page.keyboard.type("1,5");
    await page.keyboard.press("Enter");
    const refused = page.getByRole("alert").filter({ hasText: "was not put in" });
    await refused.waitFor();
    assert.match(
      await refused.textContent(),
      /Error:\s*“1,5” was not put in “seeds”, which holds whole numbers, such as 12\. Type a whole number, or nothing for a missing value\./,
    );
    await cellSays(page, "p1", 3, "10");
    await shoot(page, engine, "cells-refused");
    await refused.getByRole("button", { name: "Dismiss" }).click();
    await refused.waitFor({ state: "detached" });

    // A category suggests its values as the cell is typed in.
    await cell(grid, "p3", 2).dblclick();
    const origin = grid.getByRole("combobox", { name: "origin of p3" });
    await origin.waitFor();
    assert.deepEqual(
      await origin.evaluate((field) =>
        [...(field.list?.options ?? [])].map((option) => option.value),
      ),
      ["Spain", "Peru"],
    );
    // The list closes once the one value that fits is the text typed.
    const suggested = () =>
      origin.evaluate((field) => [...(field.list?.options ?? [])].map((option) => option.value));
    await origin.fill("Pe");
    assert.deepEqual(await suggested(), ["Spain", "Peru"]);
    await origin.fill("Peru");
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll("datalist option").length === 0,
    );
    await page.keyboard.press("Escape");

    // "Apply to all selected rows": three rows selected, and a double-click
    // on one of them keeps the three; the value goes to each, in one edit.
    await rowNamed(grid, "p1").click();
    await rowNamed(grid, "p3").click({ modifiers: ["Shift"] });
    await countSays(page, "4 individuals · 3 selected");
    await cell(grid, "p2", 2).dblclick();
    const many = grid.getByRole("combobox", { name: "origin of p2" });
    await many.waitFor();
    const toSelected = grid.getByRole("checkbox", { name: "Apply to all selected rows" });
    assert.equal(await toSelected.isChecked(), false);
    // Beside the cell, clear of the suggestions below the field.
    const field = await many.boundingBox();
    const box = await toSelected.locator("..").boundingBox();
    assert.ok(
      box.x >= field.x + field.width - 1,
      `the checkbox at ${box.x}, the field ends at ${field.x + field.width}`,
    );
    assert.ok(box.y < field.y + field.height, "the checkbox beside the field, not below it");
    await toSelected.check();
    await shoot(page, engine, "cells-to-selected");
    await many.fill("Spain");
    await many.press("Enter");
    await many.waitFor({ state: "detached" });
    await rowsShown(page, [
      ["p1", "1,5", "Spain", "10"],
      ["p2", "2,75", "Spain", "12"],
      ["p3", "missing", "Spain", "missing"],
      ["p4", "13", "Spain", "7"],
    ]);
    // The double-click left the selection as it was.
    assert.deepEqual(await selectedRows(page), ["p1", "p2", "p3"]);
    // So does a slow one, from a user whose system's double-click time is
    // longer than the 500 ms the table once waited: the pause is the user's
    // own, between the two clicks the browser counts as one double-click
    // (issue #3).
    const slow = await cell(grid, "p2", 2).boundingBox();
    const slowAt = { x: slow.x + slow.width / 2, y: slow.y + slow.height / 2 };
    await page.mouse.click(slowAt.x, slowAt.y);
    await page.waitForTimeout(800);
    // The second press alone, as the browser counts it: Playwright's click
    // with a count of 2 would press twice.
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await grid.getByRole("combobox", { name: "origin of p2" }).waitFor();
    await grid.getByRole("checkbox", { name: "Apply to all selected rows" }).waitFor();
    await page.keyboard.press("Escape");
    await grid.getByRole("combobox", { name: "origin of p2" }).waitFor({ state: "detached" });
    assert.deepEqual(await selectedRows(page), ["p1", "p2", "p3"]);
    // One undo gives back every row's.
    assert.equal((await backend.send({ command: "e2e:action", action: "undo" })).ok, null);
    await rowsShown(page, [
      ["p1", "1,5", "Spain", "10"],
      ["p2", "2,75", "Peru", "12"],
      ["p3", "missing", "missing", "missing"],
      ["p4", "13", "Spain", "7"],
    ]);

    // A single click on a row of the selection selects it alone, once no
    // second click follows.
    await rowNamed(grid, "p2").click();
    await countSays(page, "4 individuals · 1 selected");
    assert.deepEqual(await selectedRows(page), ["p2"]);

    // An ID is edited alone, with no checkbox, and never given twice.
    await cell(grid, "p4", 0).dblclick();
    const id = grid.getByRole("textbox", { name: "IndividualID of p4" });
    await id.waitFor();
    assert.equal(
      await grid.getByRole("checkbox", { name: "Apply to all selected rows" }).count(),
      0,
    );
    await id.fill("p2");
    await id.press("Enter");
    const taken = page.getByRole("alert").filter({ hasText: "The ID was not changed" });
    await taken.waitFor();
    await taken.getByRole("button", { name: "Dismiss" }).click();
    await cell(grid, "p4", 0).dblclick();
    await grid.getByRole("textbox", { name: "IndividualID of p4" }).fill("p9");
    await page.keyboard.press("Enter");
    await cellSays(page, "p9", 0, "p9");
    await cellSays(page, "p9", 1, "13");

    // The keyboard moves on the cells, which the grid tells a screen
    // reader through its active descendant: Enter opens the cell it is on,
    // and Enter there applies and moves to the cell below; Space selects
    // the row, Shift-Space the rows from the last one selected.
    await grid.focus();
    for (const key of ["ArrowUp", "ArrowUp", "ArrowUp", "ArrowRight"]) {
      await page.keyboard.press(key);
    }
    await activeIs(page, ["p1", 1, "1,5"]);
    await page.keyboard.press("ArrowDown");
    await activeIs(page, ["p2", 1, "2,75"]);
    await shoot(page, engine, "cells-keyboard");
    await page.keyboard.press("Enter");
    const typed = grid.getByRole("textbox", { name: "height of p2" });
    await typed.waitFor();
    await page.keyboard.type("3");
    await page.keyboard.press("Enter");
    await cellSays(page, "p2", 1, "3");
    await activeIs(page, ["p3", 1, "missing"]);
    await page.keyboard.press(" ");
    await countSays(page, "4 individuals · 1 selected");
    assert.deepEqual(await selectedRows(page), ["p3"]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+ ");
    await countSays(page, "4 individuals · 2 selected");
    assert.deepEqual(await selectedRows(page), ["p3", "p9"]);
    // Shift with a move up or down extends the selection from the row the
    // run of moves started on.
    for (const key of ["ArrowUp", "ArrowUp", "ArrowUp"]) {
      await page.keyboard.press(key);
    }
    await activeIs(page, ["p1", 1, "1,5"]);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await countSays(page, "4 individuals · 3 selected");
    assert.deepEqual(await selectedRows(page), ["p1", "p2", "p3"]);
    await page.keyboard.press("Shift+ArrowUp");
    await countSays(page, "4 individuals · 2 selected");
    assert.deepEqual(await selectedRows(page), ["p1", "p2"]);
    // The checkbox is offered in the last column, at the cell's left.
    await page.keyboard.press("End");
    await activeIs(page, ["p2", 3, "12"]);
    await page.keyboard.press("Enter");
    const seeds = grid.getByRole("textbox", { name: "seeds of p2" });
    await seeds.waitFor();
    const last = await seeds.boundingBox();
    const left = await grid
      .getByRole("checkbox", { name: "Apply to all selected rows" })
      .locator("..")
      .boundingBox();
    assert.ok(left.x + left.width <= last.x + 1, "the checkbox at the left of the last column");
    await shoot(page, engine, "cells-last-column");
    await page.keyboard.press("Escape");
    await page.keyboard.press("PageDown");
    await activeIs(page, ["p9", 3, "7"]);
    await page.keyboard.press("Home");
    await activeIs(page, ["p9", 0, "p9"]);

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e cells, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/** The row of the individual `name`. */
function rowNamed(grid, name) {
  return grid
    .getByRole("row")
    .filter({ has: grid.page().getByRole("gridcell", { name, exact: true }) });
}

/** The cell of column `index`, 0 for the IDs, in the row of `name`. */
function cell(grid, name, index) {
  return rowNamed(grid, name).getByRole("gridcell").nth(index);
}

/** The texts of the cells of the rows drawn, in order; `null` while a row waits for its page. */
function cellsDrawn() {
  const rows = [...globalThis.document.querySelectorAll('[role="row"][aria-rowindex]')].filter(
    (row) => row.getAttribute("aria-rowindex") !== "1",
  );
  if (rows.some((row) => row.getAttribute("aria-busy") === "true")) {
    return null;
  }
  return rows.map((row) =>
    [...row.querySelectorAll('[role="gridcell"]')].map((each) => each.textContent.trim()),
  );
}

/** Waits until the rows drawn have the cells `expected`, in order. */
async function rowsShown(page, expected) {
  const want = JSON.stringify(expected);
  try {
    await page.waitForFunction((wanted) => {
      const rows = [...globalThis.document.querySelectorAll('[role="row"][aria-rowindex]')].filter(
        (row) => row.getAttribute("aria-rowindex") !== "1",
      );
      if (rows.some((row) => row.getAttribute("aria-busy") === "true")) {
        return false;
      }
      const got = rows.map((row) =>
        [...row.querySelectorAll('[role="gridcell"]')].map((each) => each.textContent.trim()),
      );
      return JSON.stringify(got) === wanted;
    }, want);
  } catch (error) {
    throw new Error(`rows drawn ${JSON.stringify(await page.evaluate(cellsDrawn))}, not ${want}`, {
      cause: error,
    });
  }
}

/** Waits until the cell of column `index` in the row of `name` shows `text`. */
async function cellSays(page, name, index, text) {
  await page.waitForFunction(
    ([individual, column, want]) => {
      const row = [...globalThis.document.querySelectorAll('[role="row"]')].find(
        (each) => each.querySelector('[role="gridcell"]')?.textContent.trim() === individual,
      );
      return row?.querySelectorAll('[role="gridcell"]')[column]?.textContent.trim() === want;
    },
    [name, index, text],
  );
}

/** The names of the rows drawn as selected. */
async function selectedRows(page) {
  return page.evaluate(() =>
    [...globalThis.document.querySelectorAll('[role="row"][aria-selected="true"]')].map((row) =>
      row.querySelector('[role="gridcell"]')?.textContent?.trim(),
    ),
  );
}

/** Waits until the count told to a screen reader, once it stopped changing, is `text`. */
async function countSays(page, text) {
  await page.getByRole("status").filter({ hasText: text }).waitFor();
}

/**
 * Waits until the grid has the focus and its active descendant is the cell
 * of the row named `name`, column `index`, showing `text`.
 */
async function activeIs(page, [name, index, text]) {
  const want = JSON.stringify([name, index, text]);
  try {
    await page.waitForFunction((wanted) => {
      const grid = globalThis.document.activeElement;
      const id = grid?.getAttribute("aria-activedescendant");
      const cell = id ? globalThis.document.getElementById(id) : null;
      const row = cell?.closest('[role="row"]');
      if (grid?.getAttribute("role") !== "grid" || !row) return false;
      const cells = [...row.querySelectorAll('[role="gridcell"]')];
      const got = [cells[0].textContent.trim(), cells.indexOf(cell), cell.textContent.trim()];
      return JSON.stringify(got) === wanted;
    }, want);
  } catch (error) {
    throw new Error(`the active cell is not ${want}`, { cause: error });
  }
}

/** Waits until the table's grid has the focus. */
async function focusOnGrid(page) {
  await page.waitForFunction(
    () => globalThis.document.activeElement?.getAttribute("role") === "grid",
  );
}

/** A screenshot in the light and in the dark appearance, with reduced motion. */
async function shoot(page, engine, name) {
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.screenshot({ path: `${OUT}${name}-${colorScheme}-${engine}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}
