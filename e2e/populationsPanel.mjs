// The populations panel of the main window against the real core, in each
// engine: a table loaded while the window is open, choosing the
// classification, selecting a population and the unassigned individuals,
// the pointer's modes, and a change made elsewhere showing in the counts.
// Screenshots of each state, light and dark, land in e2e/output/.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

/** Five plants: origin (Spain, Peru, Chile) active, cluster (A, B), height. */
const PLANTS = {
  header: "accession",
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
  ],
  activeClassification: 2,
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true, viewport: { width: 900, height: 560 } });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);

    const panel = page.getByRole("region", { name: "Populations" });
    await panel.waitFor();
    const classification = panel.getByRole("combobox", { name: "Classification" });
    assert.equal(await classification.inputValue(), "2");
    assert.deepEqual(await classification.locator("option").allTextContents().then(trim), [
      "None",
      "origin",
      "cluster",
    ]);
    const rows = panel.getByRole("button");
    assert.deepEqual(await rows.allTextContents().then(trim), [
      "Spain 3",
      "Peru 1",
      "Chile 0",
      "Unassigned 1",
    ]);
    const pointer = panel.getByRole("group", { name: "Pointer" });
    assert.equal(await pointer.count(), 0, "no pointer modes with nothing selected");
    await shoot(page, engine, "populations-none-selected");

    // Selecting Peru: the row is pressed once the change comes back.
    await panel.getByRole("button", { name: /^Peru/ }).click();
    await waitPressed(panel, "Peru", "true");
    await pointer.waitFor();
    assert.equal(await pointer.getByRole("radio", { name: /Move/ }).isChecked(), true);
    await pointer.getByRole("radio", { name: /Remove/ }).check();
    await shoot(page, engine, "populations-peru-selected");

    // The unassigned individuals selected: Remove is disabled, with its
    // reason, and the mode falls back to Move.
    await panel.getByRole("button", { name: /^Unassigned/ }).click();
    await waitPressed(panel, "Unassigned", "true");
    const remove = pointer.getByRole("radio", { name: /Remove/ });
    assert.equal(await remove.isDisabled(), true);
    assert.equal(await pointer.getByRole("radio", { name: /Move/ }).isChecked(), true);
    await panel
      .getByText("Unassigned individuals are in no population to remove them from.")
      .waitFor();
    await shoot(page, engine, "populations-unassigned-selected");

    // A change made elsewhere, as by a lasso in another window: rows 0 and 1
    // become unassigned, and the counts follow.
    const answer = await backend.send({
      window: "main",
      command: "assign_rows",
      raw: [0b00011],
      headers: { column: "2", target: "unassigned", "based-on": "3" },
    });
    assert.deepEqual(answer.ok, null, JSON.stringify(answer));
    await panel.getByRole("button", { name: /^Unassigned 3/ }).waitFor();
    assert.deepEqual(await rows.allTextContents().then(trim), [
      "Spain 2",
      "Peru 0",
      "Chile 0",
      "Unassigned 3",
    ]);

    // Pressing the selected row again deselects it.
    await panel.getByRole("button", { name: /^Unassigned/ }).click();
    await waitPressed(panel, "Unassigned", "false");
    await pointer.waitFor({ state: "detached" });

    // Another classification.
    await classification.selectOption({ label: "cluster" });
    await panel.getByRole("button", { name: /^A / }).waitFor();
    assert.deepEqual(await rows.allTextContents().then(trim), ["A 2", "B 2", "Unassigned 1"]);
    await classification.selectOption({ label: "None" });
    await rows.first().waitFor({ state: "detached" });

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e populations panel, ${engine}: passed`);
  } finally {
    await app.close();
  }
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
