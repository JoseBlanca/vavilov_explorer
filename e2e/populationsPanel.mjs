// The populations panel of the main window against the real core, in each
// engine: a table loaded while the window is open, choosing the
// classification, selecting a group, + and − pressed and released, the rows
// selected in the table while one is pressed, what the information bar says,
// Undo and Escape, the unassigned individuals, Add group with a name refused
// and one taken, and a classification of TRUE and FALSE, which takes no new
// group. Screenshots of each state, light and dark, land in e2e/output/.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

/**
 * Five plants: height; origin (Spain, Peru, Chile) active, Spain, Peru,
 * missing, Spain, Spain; cluster (A, B); fertile, TRUE or FALSE; and
 * flowering, TRUE alone.
 */
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
    {
      name: "cluster",
      levels: [
        ["A", [0, 114, 178]],
        ["B", [213, 94, 0]],
      ],
      codes: [0, 0, 1, 1, null],
    },
    { name: "fertile", boolean: [true, false, null, true, true] },
    { name: "flowering", boolean: [true, true, null, true, true] },
  ],
  activeClassification: 2,
};

const UNDO_EACH = "Edit > Undo takes back each change.";

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
    await panel.waitFor();
    const grid = page.getByRole("grid", { name: "Individuals" });
    const classification = panel.getByRole("combobox", {
      name: "Classification column",
      exact: true,
    });
    assert.equal(await classification.inputValue(), "2");
    assert.deepEqual(await classification.locator("option").allTextContents().then(trim), [
      "None",
      "origin",
      "cluster",
      "fertile",
      "flowering",
    ]);
    await rowsAre(panel, ["Spain 3", "Peru 1", "Chile 0", "Unassigned 1"]);
    assert.equal(await panel.getByRole("button", { name: /^Add selected/ }).count(), 0);
    const addGroup = panel.getByRole("button", { name: "Add group", exact: true });
    await addGroup.waitFor();
    await shoot(page, engine, "populations-none-selected");

    // Selecting Peru shows its + and −, neither pressed.
    await panel.getByRole("button", { name: /^Peru/ }).click();
    await waitPressed(panel, "Peru", "true");
    const addToPeru = panel.getByRole("button", { name: "Add selected to Peru", exact: true });
    const removeFromPeru = panel.getByRole("button", {
      name: "Remove selected from Peru",
      exact: true,
    });
    await rowsAre(panel, ["Spain 3", "Peru 1 + −", "Chile 0", "Unassigned 1"]);
    assert.equal(await addToPeru.getAttribute("aria-pressed"), "false");
    assert.equal(await removeFromPeru.getAttribute("aria-pressed"), "false");
    assert.equal(await addToPeru.getAttribute("title"), "Add selected to Peru");

    // p1 to p3 selected, Spain, Peru and an unassigned one; pressing + puts
    // the two not in Peru in it at once, and the button stays pressed.
    await rowNamed(grid, "p1").click();
    await rowNamed(grid, "p3").click({ modifiers: ["Shift"] });
    await addToPeru.click();
    await says(
      page,
      `2 individuals added to Peru. Rows you select now go to Peru too, until you press + again or Escape; ${UNDO_EACH}`,
    );
    await rowsAre(panel, ["Spain 2", "Peru 3 + −", "Chile 0", "Unassigned 0"]);
    await waitAttribute(addToPeru, "aria-pressed", "true");
    assert.equal(
      await addToPeru.getAttribute("title"),
      "Add selected to Peru: on. Press + again, or Escape, to stop.",
    );
    await shoot(page, engine, "populations-plus-pressed");

    // While + is pressed, a row clicked goes to Peru, one undo each.
    await rowNamed(grid, "p4").click();
    await rowsAre(panel, ["Spain 1", "Peru 4 + −", "Chile 0", "Unassigned 0"]);
    await choose("undo");
    await rowsAre(panel, ["Spain 2", "Peru 3 + −", "Chile 0", "Unassigned 0"]);

    // Pressing − releases +; p4, selected and in Spain, stays. A row of
    // Peru clicked then leaves it.
    await removeFromPeru.click();
    await says(
      page,
      `Rows you select now leave Peru, if they are in it, until you press − again or Escape; ${UNDO_EACH}`,
    );
    await waitAttribute(removeFromPeru, "aria-pressed", "true");
    assert.equal(await addToPeru.getAttribute("aria-pressed"), "false");
    await rowNamed(grid, "p1").click();
    await rowsAre(panel, ["Spain 2", "Peru 2 + −", "Chile 0", "Unassigned 1"]);
    await shoot(page, engine, "populations-minus-pressed");

    // Escape releases it, and a row clicked then stays as it is.
    await page.keyboard.press("Escape");
    await says(page, "Rows you select no longer leave Peru.");
    await waitAttribute(removeFromPeru, "aria-pressed", "false");
    await rowNamed(grid, "p2").click();
    await waitSelected(grid, ["p2"]);
    await rowsAre(panel, ["Spain 2", "Peru 2 + −", "Chile 0", "Unassigned 1"]);

    // Another group selected releases the button too.
    await addToPeru.click();
    await says(
      page,
      `Rows you select now go to Peru, until you press + again or Escape; ${UNDO_EACH}`,
    );
    await panel.getByRole("button", { name: /^Chile/ }).click();
    await says(page, "Rows you select no longer go to Peru.");
    const addToChile = panel.getByRole("button", { name: "Add selected to Chile", exact: true });
    assert.equal(await addToChile.getAttribute("aria-pressed"), "false");

    // The unassigned individuals selected: + reads "Make selected
    // unassigned", and − is greyed out with its reason.
    await panel.getByRole("button", { name: /^Unassigned/ }).click();
    await waitPressed(panel, "Unassigned", "true");
    const removeUnassigned = panel.getByRole("button", { name: "Remove selected", exact: true });
    assert.equal(await removeUnassigned.getAttribute("aria-disabled"), "true");
    assert.equal(
      await removeUnassigned.getAttribute("title"),
      "Unassigned individuals are in no group to remove them from.",
    );
    // A press on a greyed-out button does nothing; Playwright presses it
    // only when forced, as it refuses a button that is not enabled.
    await removeUnassigned.click({ force: true });
    assert.equal(await removeUnassigned.getAttribute("aria-pressed"), "false");
    const makeUnassigned = panel.getByRole("button", {
      name: "Make selected unassigned",
      exact: true,
    });
    await makeUnassigned.click();
    await says(
      page,
      `1 individual made unassigned. Rows you select are now made unassigned too, until you press + again or Escape; ${UNDO_EACH}`,
    );
    await rowsAre(panel, ["Spain 2", "Peru 1", "Chile 0", "Unassigned 2 + −"]);
    await shoot(page, engine, "populations-unassigned-pressed");
    await makeUnassigned.click();
    await says(page, "Rows you select are no longer made unassigned.");

    // Add group: a name another group has is refused, and the field keeps
    // it; a new one is added last, empty, and selected.
    await addGroup.click();
    const name = panel.getByRole("textbox", { name: "Name of the new group" });
    await name.waitFor();
    assert.equal(await isFocused(name), true);
    // A name of text has at most 30 characters.
    assert.equal(await name.getAttribute("maxlength"), "30");
    await page.keyboard.type("Peru");
    await page.keyboard.press("Enter");
    const refused = page.getByRole("alert").filter({ hasText: "was not added" });
    await refused.waitFor();
    assert.match(
      await refused.textContent(),
      /Error:\s*“Peru” was not added to “origin”, which has the group Peru already\./,
    );
    assert.equal(await name.inputValue(), "Peru");
    await shoot(page, engine, "populations-name-refused");
    await refused.getByRole("button", { name: "Dismiss" }).click();
    await name.fill(" China");
    await name.press("Enter");
    await name.waitFor({ state: "detached" });
    await waitPressed(panel, "China", "true");
    await rowsAre(panel, ["Spain 2", "Peru 1", "Chile 0", "China 0 + −", "Unassigned 2"]);
    assert.equal(await isFocused(addGroup), true);
    await shoot(page, engine, "populations-group-added");

    // The new group takes the selected row like any other.
    const addToChina = panel.getByRole("button", { name: "Add selected to China", exact: true });
    await addToChina.click();
    await says(
      page,
      `1 individual added to China. Rows you select now go to China too, until you press + again or Escape; ${UNDO_EACH}`,
    );
    await rowsAre(panel, ["Spain 2", "Peru 1", "Chile 0", "China 1 + −", "Unassigned 1"]);

    // Escape in the field of a name gives up the name, and leaves + pressed;
    // Escape outside it then releases +.
    await addGroup.click();
    await name.waitFor();
    await page.keyboard.type("Japan");
    await page.keyboard.press("Escape");
    await name.waitFor({ state: "detached" });
    assert.equal(await isFocused(addGroup), true);
    assert.equal(await addToChina.getAttribute("aria-pressed"), "true");
    await page.keyboard.press("Escape");
    await says(page, "Rows you select no longer go to China.");
    await waitAttribute(addToChina, "aria-pressed", "false");

    // Escape on a button of the form of a name closes the form, and leaves
    // + pressed; Escape on a checkbox, which takes no Escape, releases it.
    await addToChina.click();
    await waitAttribute(addToChina, "aria-pressed", "true");
    await addGroup.click();
    await name.waitFor();
    await panel.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Escape");
    await name.waitFor({ state: "detached" });
    assert.equal(await addToChina.getAttribute("aria-pressed"), "true");
    await page.getByRole("checkbox", { name: "Whole cell" }).focus();
    await page.keyboard.press("Escape");
    await says(page, "Rows you select no longer go to China.");
    await waitAttribute(addToChina, "aria-pressed", "false");

    // A window reloaded with + pressed shows it pressed, and says when it
    // is released.
    await addToChina.click();
    await waitAttribute(addToChina, "aria-pressed", "true");
    await page.reload();
    await waitAttribute(addToChina, "aria-pressed", "true");
    await page.keyboard.press("Escape");
    await says(page, "Rows you select no longer go to China.");
    await waitAttribute(addToChina, "aria-pressed", "false");

    // Escape in a field typed in, or in a dialog, is theirs: + stays pressed.
    await addToChina.click();
    await waitAttribute(addToChina, "aria-pressed", "true");
    await page.getByRole("searchbox", { name: "Find" }).focus();
    await page.keyboard.press("Escape");
    await roleOf(grid, "origin").focus();
    await roleOf(grid, "origin").selectOption("text");
    const question = page.getByRole("dialog", { name: "Make “origin” text?" });
    await question.waitFor();
    await page.keyboard.press("Escape");
    await question.waitFor({ state: "hidden" });
    assert.equal(await addToChina.getAttribute("aria-pressed"), "true");
    await addToChina.click();
    await says(page, "Rows you select no longer go to China.");

    // A table loaded releases + without a word: the bar starts afresh.
    await addToChina.click();
    await waitAttribute(addToChina, "aria-pressed", "true");
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    await rowsAre(panel, ["Spain 3", "Peru 1", "Chile 0", "Unassigned 1"]);
    assert.equal(await page.getByRole("status").filter({ hasText: "no longer" }).count(), 0);

    // A double-click on Add sends the name once, and no refusal follows.
    await addGroup.click();
    await name.waitFor();
    await name.fill("Mexico");
    await panel.getByRole("button", { name: "Add", exact: true }).dblclick();
    await rowsAre(panel, ["Spain 3", "Peru 1", "Chile 0", "Mexico 0 + −", "Unassigned 1"]);
    const addToMexico = panel.getByRole("button", { name: "Add selected to Mexico", exact: true });
    await addToMexico.click();
    await says(page, "Rows you select now go to Mexico");
    assert.equal(await page.getByRole("alert").filter({ hasText: "was not added" }).count(), 0);

    // Undoing the group while its + has the focus keeps the focus in the
    // panel, on Add group.
    await addToMexico.focus();
    await choose("undo");
    await rowsAre(panel, ["Spain 3", "Peru 1", "Chile 0", "Unassigned 1"]);
    await page.waitForFunction(() =>
      globalThis.document.activeElement?.matches("[data-add-group] button"),
    );

    // Another classification chosen releases + too, and says so.
    await panel.getByRole("button", { name: /^Peru/ }).click();
    await addToPeru.click();
    await waitAttribute(addToPeru, "aria-pressed", "true");
    await classification.selectOption({ label: "cluster" });
    await says(page, "Rows you select no longer go to Peru.");

    // A classification of TRUE and FALSE takes no other group.
    await classification.selectOption({ label: "fertile" });
    await rowsAre(panel, ["FALSE 1", "TRUE 3", "Unassigned 1"]);
    assert.equal(await addGroup.getAttribute("aria-disabled"), "true");
    assert.equal(
      await addGroup.getAttribute("title"),
      "“fertile” has both TRUE and FALSE, and takes no other group.",
    );
    await addGroup.click({ force: true });
    assert.equal(await name.count(), 0);
    await shoot(page, engine, "populations-yes-or-no");

    // A column of TRUE alone takes FALSE as a new group.
    await classification.selectOption({ label: "flowering" });
    await rowsAre(panel, ["TRUE 4", "Unassigned 1"]);
    assert.equal(await addGroup.getAttribute("aria-disabled"), "false");
    await addGroup.click();
    await name.waitFor();
    assert.equal(await name.getAttribute("maxlength"), null);
    await name.fill("false");
    await name.press("Enter");
    await rowsAre(panel, ["TRUE 4", "FALSE 0 + −", "Unassigned 1"]);
    assert.equal(await addGroup.getAttribute("aria-disabled"), "true");

    await classification.selectOption({ label: "None" });
    await addGroup.waitFor({ state: "detached" });
    assert.equal(await panel.getByRole("listitem").count(), 0);

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e populations panel, ${engine}: passed`);
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
    const got = trim(await panel.getByRole("listitem").allTextContents());
    throw new Error(`rows ${JSON.stringify(got)}, expected ${want}`, { cause: error });
  }
}

/** Waits until the information bar tells `text`. */
async function says(page, text) {
  await page.getByRole("status").filter({ hasText: text }).first().waitFor();
}

/** The row of the grid whose first cell is `name`. */
function rowNamed(grid, name) {
  return grid
    .getByRole("row")
    .filter({ has: grid.page().getByRole("gridcell", { name, exact: true }) });
}

/** The dropdown of the role of the column `name`. */
function roleOf(grid, name) {
  return grid.getByRole("combobox", { name: `Role of ${name}`, exact: true });
}

/** Waits until `locator` has the attribute `name` of `value`. */
async function waitAttribute(locator, name, value) {
  await locator.and(locator.page().locator(`[${name}="${value}"]`)).waitFor();
}

/** Waits until the rows selected among those drawn are those named. */
async function waitSelected(grid, names) {
  await grid.page().waitForFunction((expected) => {
    const rows = [...globalThis.document.querySelectorAll('[role="row"][aria-selected="true"]')];
    const got = rows.map((row) => row.querySelector('[role="gridcell"]')?.textContent?.trim());
    return JSON.stringify(got) === JSON.stringify(expected);
  }, names);
}

/** Whether `locator` has the focus. */
async function isFocused(locator) {
  return locator.evaluate((element) => element === globalThis.document.activeElement);
}

/** The texts of elements, with their runs of white space made one space. */
function trim(texts) {
  return texts.map((text) => text.replace(/\s+/g, " ").trim());
}

/** Waits until the row whose name starts with `name` has `aria-pressed` of `pressed`. */
async function waitPressed(panel, name, pressed) {
  const row = panel.getByRole("button", { name: new RegExp(`^${name}`) });
  await row.and(panel.locator(`[aria-pressed="${pressed}"]`)).waitFor();
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
