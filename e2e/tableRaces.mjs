// The table and the populations panel when answers and messages arrive in
// an order the ordinary run does not give, against the real core, in each
// engine: a page of rows still on its way when another table loads; a page
// answered after a change of role whose message has not yet arrived; rows
// whose height is not a whole number of pixels, far down a long table; and
// a refused change of role or of the classification column, which leaves
// each dropdown showing what the backend holds. The test holds a call or
// the channel's messages back, in the page, and lets them go.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, launch } from "./harness.mjs";

/** A table of `numRows` plants named `prefix` and a number, with a note. */
function plants(numRows, prefix) {
  const indexes = [...Array(numRows).keys()];
  return {
    header: "IndividualID",
    names: indexes.map((i) => `${prefix}${String(i + 1)}`),
    columns: [
      { name: "height", numeric: indexes.map((i) => 100 + i) },
      { name: "note", text: indexes.map((i) => (i % 2 === 0 ? "landrace" : "cultivar")) },
      { name: "fertile", boolean: indexes.map((i) => i % 3 !== 0) },
    ],
    activeClassification: 3,
  };
}

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true, viewport: { width: 1000, height: 560 } });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    await page.evaluate(holdInPage);
    const grid = page.getByRole("grid", { name: "Individuals" });

    // 1. A page on its way when another table loads: the new table's rows
    // are drawn once the old page is dropped, without a scroll.
    await page.evaluate(() => globalThis.__e2eHold.add("fetch_rows"));
    await load(backend, plants(300, "a"));
    await page.waitForFunction(() => globalThis.__e2eHeld.length > 0);
    await load(backend, plants(150, "b"));
    await grid.and(page.locator('[aria-rowcount="151"]')).waitFor();
    await page.evaluate(() => {
      globalThis.__e2eHold.delete("fetch_rows");
      globalThis.__e2eRelease();
    });
    await rowNamed(grid, "b1").waitFor({ timeout: 5000 });

    // 2. A page answered after a change of role whose message is held: note
    // made a category while the window still has it as text, and a scroll
    // fetches a page the backend answers with its codes.
    await page.evaluate(() => {
      globalThis.__e2eHoldChannel = true;
    });
    const made = await backend.send({
      window: "main",
      command: "set_role",
      // Made from the copy of the table loaded at revision 2, b.
      json: { column: 2, role: "category", basedOn: 2 },
    });
    assert.equal(made.ok, null, JSON.stringify(made));
    await page.waitForFunction(() => globalThis.__e2eHeldMessages.length > 0);
    const answersBefore = await page.evaluate(() => globalThis.__e2eAnswers);
    await scrollTo(page, 1);
    // The page of the last rows is answered; then its draw, a frame later.
    await page.waitForFunction((before) => globalThis.__e2eAnswers > before, answersBefore);
    await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)));
    await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)));
    assert.deepEqual(errors, [], "no defect while the change of role is on its way");
    await page.evaluate(() => {
      globalThis.__e2eHoldChannel = false;
      globalThis.__e2eReleaseMessages();
    });
    await waitValue(roleOf(grid, "note"), "category");
    await rowNamed(grid, "b150").waitFor();
    assert.deepEqual(errors, [], "no defect after the change of role arrived");

    // 3. Rows of 29.75 px, a root font of 17 px, 10,000 rows: far down, the
    // rows under the viewport are drawn.
    await page.addStyleTag({ content: ":root { font-size: 17px; }" });
    await load(backend, plants(10_000, "c"));
    await grid.and(page.locator('[aria-rowcount="10001"]')).waitFor();
    await scrollTo(page, 0.8);
    await page.waitForFunction(
      () => {
        const scroller = globalThis.document.querySelector("[data-scroller]");
        if (!(scroller instanceof globalThis.HTMLElement)) return false;
        const view = scroller.getBoundingClientRect();
        const rows = [...scroller.querySelectorAll('[role="row"][aria-rowindex]')].filter((row) => {
          const box = row.getBoundingClientRect();
          return (
            row.getAttribute("aria-rowindex") !== "1" &&
            box.bottom > view.top + 40 &&
            box.top < view.bottom
          );
        });
        return rows.length >= 10;
      },
      null,
      { timeout: 5000 },
    );
    await page.addStyleTag({ content: ":root { font-size: 16px; }" });

    // 4. A refused change of role: the dropdown shows the role the column
    // still has.
    await load(backend, plants(20, "d"));
    await rowNamed(grid, "d1").waitFor();
    await page.evaluate(() =>
      globalThis.__e2eRefuse.set("set_role", { kind: "unknownColumn", column: 2 }),
    );
    await roleOf(grid, "note").selectOption("category");
    await waitValue(roleOf(grid, "note"), "text");

    // 5. A refused choice of the classification column: the panel's dropdown
    // shows the one still active.
    const panel = page.getByRole("region", { name: "Populations" });
    const classification = panel.getByRole("combobox", { name: "Classification column" });
    await page.evaluate(() =>
      globalThis.__e2eRefuse.set("set_active_classification", { kind: "notCategory", column: 3 }),
    );
    await classification.selectOption({ label: "None" });
    await waitValue(classification, "3");
    await page.evaluate(() => globalThis.__e2eRefuse.clear());

    // 6. The user chooses None; the backend, as from another window, sets
    // fertile again: the dropdown shows fertile.
    await classification.selectOption({ label: "None" });
    await panel.getByRole("button", { name: /^TRUE/ }).waitFor({ state: "detached" });
    const again = await backend.send({
      window: "main",
      command: "set_active_classification",
      // Made from the copy of the table loaded at revision 5, d.
      json: { column: 3, basedOn: 5 },
    });
    assert.equal(again.ok, null, JSON.stringify(again));
    await panel.getByRole("button", { name: /^TRUE/ }).waitFor();
    assert.equal(await classification.inputValue(), "3");

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e table races, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/**
 * Wraps the page's way to the backend: a call whose command is in
 * `__e2eHold` waits in `__e2eHeld` until `__e2eRelease()`; one in
 * `__e2eRefuse` is answered with that refusal; and while `__e2eHoldChannel`
 * is set, channel messages wait in `__e2eHeldMessages` until
 * `__e2eReleaseMessages()`.
 */
function holdInPage() {
  const call = globalThis.__e2eCall;
  const deliver = globalThis.__e2eDeliver;
  globalThis.__e2eHold = new Set();
  globalThis.__e2eHeld = [];
  globalThis.__e2eRefuse = new Map();
  globalThis.__e2eHoldChannel = false;
  globalThis.__e2eHeldMessages = [];
  globalThis.__e2eAnswers = 0;
  const counted = (sent) =>
    call(sent).then((answer) => {
      globalThis.__e2eAnswers += 1;
      return answer;
    });
  globalThis.__e2eCall = (sent) => {
    const refusal = globalThis.__e2eRefuse.get(sent.command);
    if (refusal !== undefined) return Promise.resolve({ error: refusal });
    if (!globalThis.__e2eHold.has(sent.command)) return counted(sent);
    return new Promise((resolve) => {
      globalThis.__e2eHeld.push(() => counted(sent).then(resolve));
    });
  };
  globalThis.__e2eRelease = () => {
    for (const release of globalThis.__e2eHeld.splice(0)) release();
  };
  globalThis.__e2eDeliver = (index, message) => {
    if (globalThis.__e2eHoldChannel) globalThis.__e2eHeldMessages.push([index, message]);
    else deliver(index, message);
  };
  globalThis.__e2eReleaseMessages = () => {
    for (const [index, message] of globalThis.__e2eHeldMessages.splice(0)) deliver(index, message);
  };
}

/** Loads `table` as the import will, and checks that it loaded. */
async function load(backend, table) {
  const loaded = await backend.send({ command: "e2e:load", table });
  assert.equal(loaded.ok, null, JSON.stringify(loaded));
}

/** Scrolls the table to `fraction` of its height. */
function scrollTo(page, fraction) {
  return page.locator("[data-scroller]").evaluate((scroller, at) => {
    scroller.scrollTop = scroller.scrollHeight * at;
  }, fraction);
}

/** Waits until the dropdown `select` shows the option of `value`. */
async function waitValue(select, value) {
  await select
    .page()
    .waitForFunction(
      ([element, wanted]) => element.value === wanted,
      [await select.elementHandle(), value],
      { timeout: 2000 },
    );
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
