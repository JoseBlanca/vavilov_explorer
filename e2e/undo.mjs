// Undo and Redo of the Edit menu, against the real core, in each engine:
// the menu's item reaches the main window as its action, as a click in the
// app's menu or Cmd-Z would, and the window undoes and redoes the last edit,
// a change of role. An undo with nothing to undo changes nothing.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, launch } from "./harness.mjs";

/** Three plants: 1 height, a number; 2 origin, a category, active. */
const PLANTS = {
  header: "IndividualID",
  names: ["p1", "p2", "p3"],
  columns: [
    { name: "height", numeric: [1.5, 2, null] },
    {
      name: "origin",
      levels: [
        ["Spain", [230, 159, 0]],
        ["Peru", [86, 180, 233]],
      ],
      codes: [0, 1, 0],
    },
  ],
  activeClassification: 2,
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true, viewport: { width: 900, height: 500 } });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    const grid = page.getByRole("grid", { name: "Individuals" });
    const height = grid.getByRole("combobox", { name: "Role of height", exact: true });
    await height.waitFor();
    const choose = async (action) => {
      const sent = await backend.send({ command: "e2e:action", action });
      assert.equal(sent.ok, null, JSON.stringify(sent));
    };

    // With nothing to undo, Undo changes nothing, and the bar says so; Redo
    // the same.
    await choose("undo");
    await untilRole(height, "number");
    await page.getByRole("status").filter({ hasText: "There is nothing to undo." }).waitFor();
    await choose("redo");
    await page.getByRole("status").filter({ hasText: "There is nothing to redo." }).waitFor();

    // A change of role, undone and redone from the menu.
    await height.selectOption("category");
    await untilRole(height, "category");
    await choose("undo");
    await untilRole(height, "number");
    await choose("redo");
    await untilRole(height, "category");

    // Two edits are undone in the reverse order they were made.
    await height.selectOption("latitude");
    await untilRole(height, "latitude");
    await choose("undo");
    await untilRole(height, "category");
    await choose("undo");
    await untilRole(height, "number");

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e undo, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/** Waits until the dropdown of a column's role shows `role`. */
async function untilRole(dropdown, role) {
  await dropdown
    .page()
    .waitForFunction(
      ([element, expected]) => element.value === expected,
      [await dropdown.elementHandle(), role],
    );
}
