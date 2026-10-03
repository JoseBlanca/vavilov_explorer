// Edit group and Delete group in the populations panel, against the real
// core, in each engine: the buttons shown only with a group selected, a
// group renamed and given another colour, a name refused, Escape, undo and
// redo, a group deleted with its individuals left unassigned, what the
// information bar says, and a double-click that deletes once. Screenshots
// of each state, light and dark, land in e2e/output/.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

/** Five plants, with origin (Spain, Peru, Chile) active: Spain, Peru, missing, Spain, Spain. */
const PLANTS = {
  header: "IndividualID",
  names: ["p1", "p2", "p3", "p4", "p5"],
  columns: [
    { name: "height", numeric: [1.5, null, 2, 3.25, 1] },
    {
      name: "origin",
      levels: [
        ["Spain", [230, 159, 0]],
        ["Peru", [86, 180, 233]],
        ["Chile", [0, 158, 115]],
      ],
      codes: [0, 1, null, 0, 0],
    },
  ],
  activeClassification: 2,
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true, viewport: { width: 900, height: 600 } });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    const choose = async (action) => {
      const sent = await backend.send({ command: "e2e:action", action });
      assert.equal(sent.ok, null, JSON.stringify(sent));
    };
    const panel = page.getByRole("region", { name: "Populations" });
    const grid = page.getByRole("grid", { name: "Individuals" });
    const addGroup = panel.getByRole("button", { name: "Add group", exact: true });
    const editGroup = (name) => panel.getByRole("button", { name: `Edit group ${name}` });
    const deleteGroup = (name) => panel.getByRole("button", { name: `Delete group ${name}` });
    await rowsAre(panel, ["Spain 3", "Peru 1", "Chile 0", "Unassigned 1"]);

    // With no group selected, or the unassigned individuals, there is
    // nothing to edit or delete.
    await addGroup.waitFor();
    assert.equal(await panel.getByRole("button", { name: /^(Edit|Delete) group/ }).count(), 0);
    await panel.getByRole("button", { name: /^Unassigned/ }).click();
    await waitPressed(panel, "Unassigned");
    assert.equal(await panel.getByRole("button", { name: /^(Edit|Delete) group/ }).count(), 0);

    // A group selected shows both, beside Add group.
    await panel.getByRole("button", { name: /^Peru/ }).click();
    await waitPressed(panel, "Peru");
    await editGroup("Peru").waitFor();
    assert.equal(await deleteGroup("Peru").textContent().then(trimmed), "Delete group");
    await shoot(page, engine, "groups-selected");

    // Edit group opens a form with the name and the colour the group has;
    // each colour says which other group has it.
    await editGroup("Peru").click();
    const form = panel.getByRole("form", { name: "Edit group Peru" });
    const name = panel.getByRole("textbox", { name: "Name of the group" });
    await name.waitFor();
    assert.equal(await isFocused(name), true);
    assert.equal(await name.inputValue(), "Peru");
    assert.equal(await name.getAttribute("maxlength"), "30");
    assert.equal(
      await form.getByRole("radio", { name: "Sky blue", exact: true }).isChecked(),
      true,
    );
    assert.equal(await form.getByRole("radio").count(), 21);
    await form.getByRole("radio", { name: "Orange, used by Spain", exact: true }).waitFor();
    assert.equal(await addGroup.count(), 0);
    await shoot(page, engine, "groups-edit-form");

    // Another group's name is refused, and the form keeps what was typed.
    await name.fill("Spain");
    await name.press("Enter");
    const refused = page.getByRole("alert").filter({ hasText: "was not renamed" });
    await refused.waitFor();
    assert.match(
      await refused.textContent(),
      /Error:\s*Peru was not renamed “Spain”: “origin” has the group Spain already\./,
    );
    assert.equal(await name.inputValue(), "Spain");
    await refused.getByRole("button", { name: "Dismiss" }).click();

    // A new name and colour, saved, keep the group's individuals and its
    // place, and the focus goes back to Edit group.
    await name.fill(" Perú ");
    await form.getByRole("radio", { name: "Dark blue", exact: true }).check();
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await form.waitFor({ state: "detached" });
    await rowsAre(panel, ["Spain 3", "Perú 1 + −", "Chile 0", "Unassigned 1"]);
    assert.equal(await swatchOf(panel, "Perú"), "rgb(0, 68, 107)");
    assert.equal(await isFocused(editGroup("Perú")), true);
    assert.equal(await originOf(grid, "p2"), "Perú");
    await shoot(page, engine, "groups-edited");

    // Undo gives the name and colour back, and redo the new ones.
    await choose("undo");
    await rowsAre(panel, ["Spain 3", "Peru 1 + −", "Chile 0", "Unassigned 1"]);
    assert.equal(await swatchOf(panel, "Peru"), "rgb(86, 180, 233)");
    await choose("redo");
    await rowsAre(panel, ["Spain 3", "Perú 1 + −", "Chile 0", "Unassigned 1"]);

    // Escape gives up the form, and the focus goes back to Edit group.
    await editGroup("Perú").click();
    await name.waitFor();
    await page.keyboard.type("x");
    await page.keyboard.press("Escape");
    await name.waitFor({ state: "detached" });
    assert.equal(await isFocused(editGroup("Perú")), true);
    await rowsAre(panel, ["Spain 3", "Perú 1 + −", "Chile 0", "Unassigned 1"]);

    // Another group selected while the form is open closes it.
    await editGroup("Perú").click();
    await name.waitFor();
    await panel.getByRole("button", { name: /^Chile/ }).click();
    await name.waitFor({ state: "detached" });
    await editGroup("Chile").waitFor();

    // Delete group deletes Spain at once, with + pressed on it: its
    // individuals are unassigned, the bar says how to undo it, and the
    // focus goes to Add group.
    await panel.getByRole("button", { name: /^Spain/ }).click();
    await waitPressed(panel, "Spain");
    await panel.getByRole("button", { name: "Add selected to Spain", exact: true }).click();
    await deleteGroup("Spain").click();
    await says(
      page,
      "The group Spain was deleted, and its 3 individuals are unassigned now. Edit > Undo brings it back.",
    );
    await rowsAre(panel, ["Perú 1", "Chile 0", "Unassigned 4"]);
    assert.equal(await isFocused(addGroup), true);
    assert.equal(await originOf(grid, "p1"), "missing");
    assert.equal(await originOf(grid, "p2"), "Perú");
    await shoot(page, engine, "groups-deleted");

    // Undo gives Spain back in its place with its individuals, not
    // selected; redo deletes it again.
    await choose("undo");
    await rowsAre(panel, ["Spain 3", "Perú 1", "Chile 0", "Unassigned 1"]);
    assert.equal(await originOf(grid, "p1"), "Spain");
    await choose("redo");
    await rowsAre(panel, ["Perú 1", "Chile 0", "Unassigned 4"]);
    await choose("undo");

    // A group that holds no one is deleted with words that say so.
    await panel.getByRole("button", { name: /^Chile/ }).click();
    await waitPressed(panel, "Chile");
    await deleteGroup("Chile").click();
    await says(
      page,
      "The group Chile, which had no individuals, was deleted. Edit > Undo brings it back.",
    );
    await rowsAre(panel, ["Spain 3", "Perú 1", "Unassigned 1"]);
    await choose("undo");
    await rowsAre(panel, ["Spain 3", "Perú 1", "Chile 0", "Unassigned 1"]);

    // A double-click on Delete group deletes one group, not the one that
    // takes its place: one undo gives it back.
    await panel.getByRole("button", { name: /^Perú/ }).click();
    await waitPressed(panel, "Perú");
    await deleteGroup("Perú").dblclick();
    await rowsAre(panel, ["Spain 3", "Chile 0", "Unassigned 2"]);
    await choose("undo");
    await rowsAre(panel, ["Spain 3", "Perú 1", "Chile 0", "Unassigned 1"]);
    assert.equal(await page.getByRole("alert").filter({ hasText: /\S/ }).count(), 0);

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e groups, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/** Waits until the rows of the panel, each with its count and its + and −, are `expected`. */
async function rowsAre(panel, expected) {
  const want = JSON.stringify(expected);
  try {
    await panel.page().waitForFunction((wanted) => {
      const items = [
        ...globalThis.document.querySelectorAll('[aria-labelledby="populations-heading"] li'),
      ];
      const got = items.map((item) => item.textContent.replace(/\s+/g, " ").trim());
      return JSON.stringify(got) === wanted;
    }, want);
  } catch (error) {
    const got = (await panel.getByRole("listitem").allTextContents()).map(trimmed);
    throw new Error(`rows ${JSON.stringify(got)}, expected ${want}`, { cause: error });
  }
}

/** Waits until the row of the group whose name starts with `name` is the one selected. */
async function waitPressed(panel, name) {
  const row = panel.getByRole("button", { name: new RegExp(`^${name}`) });
  await row.and(panel.locator('[aria-pressed="true"]')).waitFor();
}

/** The colour of the swatch of the group whose name starts with `name`, as CSS computes it. */
async function swatchOf(panel, name) {
  return panel
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .locator('[aria-hidden="true"]')
    .evaluate((swatch) => globalThis.getComputedStyle(swatch).backgroundColor);
}

/** The text of the cell of origin, the third, in the row of the plant `plant`. */
async function originOf(grid, plant) {
  const row = grid
    .getByRole("row")
    .filter({ has: grid.page().getByRole("gridcell", { name: plant, exact: true }) });
  return row.getByRole("gridcell").nth(2).textContent().then(trimmed);
}

/** Waits until the information bar tells `text`. */
async function says(page, text) {
  await page.getByRole("status").filter({ hasText: text }).first().waitFor();
}

/** Whether `locator` has the focus. */
async function isFocused(locator) {
  return locator.evaluate((element) => element === globalThis.document.activeElement);
}

/** A text with its runs of white space made one space, and none around it. */
function trimmed(text) {
  return text.replace(/\s+/g, " ").trim();
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
