// The import and the export, carried out from the File menu, against the
// real core, in each engine: the menu's item handed to the main window as
// the app hands it, the file the test writes in the place of the one the
// user picks in the system's dialog. A table imported with its roles
// guessed; a refused import as an error in the information bar, with no
// table loaded and with one, dismissed with ×; a character not decoded as
// a warning there, gone after 5 seconds or with a later import; a refusal
// that waits behind the warning; a closed dialog that changes nothing; an
// export as CSV with the choices of a Spanish Excel and with others, their
// bytes compared, and one cancelled; two exports chosen at once; a refused
// export as Excel; a question about a role withdrawn by an import; and
// where the focus goes after each. Screenshots, light and dark, land in e2e/output/.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { ENGINES, OUT, launch } from "./harness.mjs";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vavilov-transfer-"));
const file = (name, content) => {
  const at = path.join(folder, name);
  fs.writeFileSync(at, content);
  return at;
};
const PLANTS = file(
  "plants.csv",
  "IndividualID;height;origin;lat;seeds\np1;1,5;Spain;40,4;10\np2;2;Peru;-12;\np3;NA;Spain;;7\n",
);
const ACCESSIONS = file("accessions.csv", "accession;height\nA;1\n");
// The mark of UTF-8, then a byte 0xFF on line 3, which is not UTF-8.
const DAMAGED = file(
  "damaged.csv",
  Buffer.concat([
    Buffer.from("﻿IndividualID,note\nA,x\nB,"),
    Buffer.from([0xff]),
    Buffer.from("\n"),
  ]),
);
const LARGE = file("large.csv", "IndividualID,seeds\nA,1\nB,9007199254740993\n");
// Its third column, colour, has the id origin has in plants.csv.
const COLOURS = file("colours.csv", "IndividualID;weight;colour\nq1;3;red\nq2;4;blue\n");

try {
  for (const engine of Object.keys(ENGINES)) {
    const app = await launch({
      engine,
      backend: true,
      viewport: { width: 1000, height: 560 },
      // Spanish, which writes a decimal comma; the CSV starts from the
      // region's decimal mark, which the test sets, not from the language.
      locale: "es-ES",
      // A Spanish region, so that the CSV starts from ; and a decimal comma.
      region: ",",
    });
    try {
      const { page, errors, backend } = app;
      /** Sets the decimal mark of the system's region, as the system would. */
      const region = async (decimalMark) => {
        const set = await backend.send({ command: "e2e:region", decimalMark });
        assert.equal(set.ok, null, JSON.stringify(set));
      };
      await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
      const grid = page.getByRole("grid", { name: "Individuals" });
      const errorShown = (text) => page.getByRole("alert").filter({ hasText: text });
      const warningShown = (text) => page.getByRole("status").filter({ hasText: text });
      /**
       * Chooses the menu's `action`, the dialog giving `pick`, a path or
       * cancel, and waits until the window's command took it; with no pick,
       * for an action that must ask for no file, which the program would
       * otherwise refuse as a dialog with no pick.
       */
      const choose = async (action, pick = null) => {
        if (pick !== null) {
          const picked = await backend.send({ command: "e2e:pick", ...pick });
          assert.equal(picked.ok, null, JSON.stringify(picked));
        }
        const sent = await backend.send({ command: "e2e:action", action });
        assert.equal(sent.ok, null, JSON.stringify(sent));
        // An export as CSV takes its pick once its choices are given.
        if (pick !== null && action !== "exportCsv") await untilTaken(backend);
      };

      // A refused import with no table loaded: the information bar shows
      // the error below the title, and nothing else.
      await choose("importTable", { path: ACCESSIONS });
      const firstRefused = errorShown("“accessions.csv” was not imported");
      await firstRefused.waitFor();
      assert.match(await firstRefused.textContent(), /^\s*Error:/);
      await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
      await shoot(page, engine, "transfer-refused-empty");
      await firstRefused.getByRole("button", { name: "Dismiss" }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "accessions" })
        .waitFor({ state: "detached" });
      await quiet(page);

      // A table imported: its individuals, and each column with its role,
      // and nothing else shown.
      await choose("importTable", { path: PLANTS });
      await grid.and(page.locator('[aria-rowcount="4"]')).waitFor();
      await rowNamed(grid, "p1").waitFor();
      assert.equal(await roleOf(grid, "lat").inputValue(), "latitude");
      assert.equal(await roleOf(grid, "origin").inputValue(), "category");
      assert.equal(await roleOf(grid, "seeds").inputValue(), "number");
      await quiet(page);

      // A closed dialog changes nothing, and shows nothing.
      await choose("importTable", { cancel: true });
      await quiet(page);
      await choose("exportXlsx", { cancel: true });
      await quiet(page);
      assert.equal(await grid.getAttribute("aria-rowcount"), "4");

      // A refused import: the information bar says why, in the file's
      // names, as an error, until it is dismissed with ×, which gives the
      // focus back.
      await roleOf(grid, "origin").focus();
      await choose("importTable", { path: ACCESSIONS });
      const refused = errorShown("“accessions.csv” was not imported");
      await refused.waitFor();
      assert.match(
        await refused.textContent(),
        /Error:\s*“accessions\.csv” was not imported\. Its first column, which must hold the ID of each individual, is named “accession”\. Name it IndividualID and import the file again\./,
      );
      assert.equal(await page.getByRole("dialog").count(), 0, "no dialog");
      await shoot(page, engine, "transfer-refused");
      await refused.getByRole("button", { name: "Dismiss" }).click();
      await refused.waitFor({ state: "detached" });
      await focusOn(page, "Role of origin");
      // Nothing was loaded: the table is still the plants'.
      await rowNamed(grid, "p1").waitFor();

      // A character not decoded: the table, which takes the focus from a
      // control of the table it replaced, and a warning, with no ×, which
      // goes by itself after 5 seconds and leaves the focus where it is.
      await choose("importTable", { path: DAMAGED });
      const notice = warningShown("damaged.csv");
      await notice.waitFor();
      await focusOn(page, "grid");
      assert.match(
        await notice.textContent(),
        /Warning:\s*“damaged\.csv” was imported, but line 3 has a character that could not be read/,
      );
      assert.equal(await notice.getByRole("button", { name: "Dismiss" }).count(), 0, "no ×");
      await shoot(page, engine, "transfer-notice");
      await notice.waitFor({ state: "detached", timeout: 10_000 });
      await focusOn(page, "grid");

      // A refusal while the warning is shown waits behind it, which says
      // so, and shows once the warning goes; dismissing the error gives the
      // focus back to the table.
      await choose("importTable", { path: DAMAGED });
      await notice.waitFor();
      await focusOn(page, "grid");
      await choose("importTable", { path: ACCESSIONS });
      await notice.filter({ hasText: "(1 more)" }).waitFor();
      assert.equal(await errorShown("accessions.csv").count(), 0, "the error waits");
      await shoot(page, engine, "transfer-waiting");
      const waited = errorShown("“accessions.csv” was not imported");
      await waited.waitFor({ timeout: 10_000 });
      await notice.waitFor({ state: "detached" });
      await waited.getByRole("button", { name: "Dismiss" }).click();
      await waited.waitFor({ state: "detached" });
      await focusOn(page, "grid");

      // The warning of an earlier file goes with a later import that read
      // every character, and so does an error waiting behind it.
      await choose("importTable", { path: DAMAGED });
      await notice.waitFor();
      await choose("importTable", { path: ACCESSIONS });
      await notice.filter({ hasText: "more)" }).waitFor();
      await choose("importTable", { path: PLANTS });
      await rowNamed(grid, "p1").waitFor();
      await notice.waitFor({ state: "detached" });
      await quiet(page);
      await focusOn(page, "grid");
      // origin, the first category, is the active classification, and the
      // panel shows its populations.
      const panel = page.getByRole("region", { name: "Populations" });
      assert.equal(
        await panel
          .getByRole("combobox", { name: "Classification column", exact: true })
          .evaluate((select) => select.selectedOptions[0]?.textContent.trim()),
        "origin",
      );
      await panel.getByRole("button", { name: /Spain/ }).waitFor();
      await shoot(page, engine, "transfer-imported");

      // An export as CSV, from the choices of a Spanish Excel; the focus
      // goes back to where it was.
      const exported = path.join(folder, `plants-${engine}.csv`);
      await roleOf(grid, "origin").focus();
      await choose("exportCsv", { path: exported });
      const choices = page.getByRole("dialog", { name: "Export as CSV" });
      await choices.waitFor();
      assert.equal(
        await choices.getByRole("combobox", { name: "Separator" }).inputValue(),
        "Semicolon (;)",
      );
      await shoot(page, engine, "transfer-csv");
      await choices.getByRole("button", { name: "Export…" }).click();
      await waitForFile(exported);
      assert.equal(
        fs.readFileSync(exported, "utf8"),
        "﻿IndividualID;height;origin;lat;seeds\r\n" +
          "p1;1,5;Spain;40,4;10\r\n" +
          "p2;2,0;Peru;-12,0;\r\n" +
          "p3;;Spain;;7\r\n",
      );
      await focusOn(page, "Role of origin");

      // Cancel in the dialog of the choices writes nothing, and leaves the
      // file picked for the Save dialog untaken. With a region of the
      // decimal point, as with English as the language and the United
      // States as the region, the choices start from , and a point,
      // although the window's language writes a decimal comma.
      const cancelled = path.join(folder, `cancelled-${engine}.csv`);
      await region(".");
      await choose("exportCsv");
      await choices.waitFor();
      assert.equal(
        await choices.getByRole("combobox", { name: "Separator" }).inputValue(),
        "Comma (,)",
      );
      assert.equal(
        await choices.getByRole("combobox", { name: "Decimal mark" }).inputValue(),
        "Point (1.5)",
      );
      const picked = await backend.send({ command: "e2e:pick", path: cancelled });
      assert.equal(picked.ok, null, JSON.stringify(picked));
      await choices.getByRole("button", { name: "Cancel" }).click();
      await choices.waitFor({ state: "hidden" });
      await quiet(page);
      assert.equal((await backend.send({ command: "e2e:picking" })).ok, true);
      assert.equal(fs.existsSync(cancelled), false);
      await region(",");

      // An export as CSV with other choices than a Spanish Excel's: ",", a
      // point, UTF-8 without its mark, and NA. Choosing the comma as the
      // separator moves the decimal comma to the point, the one mark then
      // offered.
      const other = path.join(folder, `other-${engine}.csv`);
      await choose("exportCsv", { path: other });
      await choices.waitFor();
      const decimal = choices.getByRole("combobox", { name: "Decimal mark" });
      assert.equal(await decimal.inputValue(), "Comma (1,5)");
      await choices
        .getByRole("combobox", { name: "Separator" })
        .selectOption({ label: "Comma (,)" });
      assert.equal(await decimal.inputValue(), "Point (1.5)");
      assert.deepEqual(await decimal.getByRole("option").allTextContents(), ["Point (1.5)"]);
      await shoot(page, engine, "transfer-csv-comma");
      await choices.getByRole("combobox", { name: "Encoding" }).selectOption({ label: "UTF-8" });
      await choices.getByRole("combobox", { name: "Missing values" }).selectOption({ label: "NA" });
      await choices.getByRole("button", { name: "Export…" }).click();
      await waitForFile(other);
      assert.equal(
        fs.readFileSync(other, "utf8"),
        "IndividualID,height,origin,lat,seeds\r\np1,1.5,Spain,40.4,10\r\np2,2.0,Peru,-12.0,NA\r\np3,NA,Spain,NA,7\r\n",
      );

      // Two items of the menu chosen at once are carried out one after the
      // other: the second export asks for its choices once the first has
      // written its file, and neither is lost.
      const first = path.join(folder, `first-${engine}.csv`);
      const second = path.join(folder, `second-${engine}.csv`);
      assert.equal((await backend.send({ command: "e2e:pick", path: first })).ok, null);
      for (let times = 0; times < 2; times += 1) {
        const sent = await backend.send({ command: "e2e:action", action: "exportCsv" });
        assert.equal(sent.ok, null, JSON.stringify(sent));
      }
      await choices.waitFor();
      await choices.getByRole("button", { name: "Export…" }).click();
      await waitForFile(first);
      await choices.waitFor();
      assert.equal((await backend.send({ command: "e2e:pick", path: second })).ok, null);
      await choices.getByRole("button", { name: "Export…" }).click();
      await waitForFile(second);
      assert.equal(fs.readFileSync(second, "utf8"), fs.readFileSync(first, "utf8"));

      await choose("importTable", { path: LARGE });
      await rowNamed(grid, "B").waitFor();

      // A refused export as Excel: a whole number beyond 2^53.
      // Refused before the Save dialog: no file is picked.
      await choose("exportXlsx");
      const notExported = errorShown("The table was not exported");
      await notExported.waitFor();
      assert.match(
        await notExported.textContent(),
        /The value of B in “seeds” is a whole number beyond ±9\.007\.199\.254\.740\.992, which a number of Excel does not hold exactly\. Export as CSV instead\./,
      );
      await shoot(page, engine, "transfer-not-exported");
      // The same refusal again is not added behind it. The menu's items are
      // carried out in turn, so once a later import took its pick, the
      // export before it has been answered.
      await choose("exportXlsx");
      await choose("importTable", { cancel: true });
      assert.equal(await notExported.filter({ hasText: "more)" }).count(), 0, "no repeat waits");
      await notExported.getByRole("button", { name: "Dismiss" }).click();
      await notExported.waitFor({ state: "detached" });

      // A question about a role left open across an import goes, and
      // changes nothing in the table imported.
      await choose("importTable", { path: PLANTS });
      await rowNamed(grid, "p1").waitFor();
      await page
        .getByRole("region", { name: "Populations" })
        .getByRole("combobox", { name: "Classification column", exact: true })
        .selectOption({ label: "origin" });
      await roleOf(grid, "origin").selectOption("text");
      const question = page.getByRole("dialog", { name: "Make “origin” text?" });
      await question.waitFor();
      await choose("importTable", { path: COLOURS });
      await rowNamed(grid, "q1").waitFor();
      await question.waitFor({ state: "hidden" });
      await quiet(page);
      assert.equal(await roleOf(grid, "colour").inputValue(), "category");
      assert.equal(await roleOf(grid, "weight").inputValue(), "number");

      assert.deepEqual(errors, [], "no page errors");
      console.log(`e2e transfer, ${engine}: passed`);
    } finally {
      await app.close();
    }
  }
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}

/**
 * Waits until the focus is on the element whose label is `label`, or on the
 * table for "grid".
 */
async function focusOn(page, label) {
  await page.waitForFunction(
    (label) => {
      const focused = globalThis.document.activeElement;
      return label === "grid"
        ? focused?.getAttribute("role") === "grid"
        : focused?.getAttribute("aria-label") === label;
    },
    label,
    { timeout: 10_000 },
  );
}

/** Asserts that no dialog is open and that the information bar shows no message. */
async function quiet(page) {
  assert.equal(await page.getByRole("dialog").count(), 0, "no dialog");
  // The count of the information bar is told to a screen reader in a
  // status of its own, a paragraph, and is left out.
  const regions = await page.locator('[role="alert"], div[role="status"]').allTextContents();
  assert.deepEqual(
    regions.map((text) => text.trim()),
    ["", ""],
    "no message",
  );
}

/** Waits until the window's command took the pick of the test program. */
async function untilTaken(backend) {
  for (let tries = 0; tries < 200; tries += 1) {
    const picking = await backend.send({ command: "e2e:picking" });
    if (picking.ok === false) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  }
  throw new Error("e2e: the window never took the file picked for its dialog");
}

/** Waits until the file at `at` exists, for a write the test cannot await. */
async function waitForFile(at) {
  for (let tries = 0; tries < 100 && !fs.existsSync(at); tries += 1) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  assert.ok(fs.existsSync(at), `${at} was written`);
}

/** The dropdown of the role of the column `name`. */
function roleOf(grid, name) {
  return grid.getByRole("combobox", { name: `Role of ${name}`, exact: true });
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
