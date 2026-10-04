// The windows of the widgets against the real core, in each engine: Plot >
// 3D scatter… asks for the axes in the main window and opens the 3D
// scatter's window, a page of its own, which names itself after its columns
// and counts the individuals it draws; an edit of an axis reaches it; a
// change of role that leaves an axis without a column of numbers, and a new
// table, close it; a window the user closed is forgotten by the session.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";
import { centreOfColour, pixelAt } from "./pixels.mjs";

/**
 * Three plants: 1 origin, a category, active; 2 height, 3 seeds and 4 PC1,
 * numbers, height missing for p2; 5 note, text.
 */
const PLANTS = {
  header: "IndividualID",
  names: ["p1", "p2", "p3"],
  columns: [
    {
      name: "origin",
      levels: [
        ["Spain", [230, 159, 0]],
        ["Peru", [86, 180, 233]],
      ],
      codes: [0, 1, 0],
    },
    { name: "height", numeric: [1.5, null, 2] },
    { name: "seeds", integer: [10, 12, 7] },
    { name: "PC1", numeric: [-0.5, 0.25, 1] },
    { name: "note", text: ["tall", null, "short"] },
  ],
  activeClassification: 1,
};

/** Three plants whose positions are far from zero and close together. */
const POSITIONS = {
  header: "IndividualID",
  names: ["q1", "q2", "q3"],
  columns: [
    { name: "position", numeric: [4500000.05, 4500000.1, 4500000.15] },
    { name: "rank", numeric: [5, 5, 5] },
  ],
  activeClassification: null,
};

/** Two plants with no column of numbers. */
const NO_NUMBERS = {
  header: "IndividualID",
  names: ["p1", "p2"],
  columns: [{ name: "note", text: ["tall", "short"] }],
  activeClassification: null,
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true, viewport: { width: 1000, height: 520 } });
  try {
    const { page, errors, backend } = app;
    await page.getByRole("heading", { name: "Vavilov Explorer" }).waitFor();
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    const grid = page.getByRole("grid", { name: "Individuals" });
    await grid.getByRole("combobox", { name: "Role of height", exact: true }).waitFor();
    const choose = async (action) => {
      const sent = await backend.send({ command: "e2e:action", action });
      assert.equal(sent.ok, null, JSON.stringify(sent));
    };

    // The dialog offers the columns of numbers on each axis, starting from
    // the first three, and Cancel opens nothing.
    await choose("scatter3d");
    const dialog = page.getByRole("dialog", { name: "3D scatter" });
    await dialog.waitFor();
    const x = dialog.getByRole("combobox", { name: "X axis" });
    const y = dialog.getByRole("combobox", { name: "Y axis" });
    const z = dialog.getByRole("combobox", { name: "Z axis" });
    assert.deepEqual(await x.locator("option").allTextContents(), ["height", "seeds", "PC1"]);
    assert.deepEqual(await chosen(x, y, z), ["height", "seeds", "PC1"]);
    await shoot(page, engine, "widgets-dialog");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached" }).catch(() => dialog.waitFor({ state: "hidden" }));
    assert.deepEqual(app.windows(), ["main"]);

    // Open opens the window with the axes chosen.
    await choose("scatter3d");
    await dialog.waitFor();
    await y.selectOption("PC1");
    await z.selectOption("height");
    await dialog.getByRole("button", { name: "Open" }).click();
    const first = await app.window("scatter3d-1");
    await first.waitForFunction(
      () => globalThis.document.title === "3D scatter of height, PC1 and height",
    );
    // A screen reader finds the plot by its name, and not its ticks as text.
    await first
      .getByRole("application", { name: "3D scatter of height, PC1 and height" })
      .waitFor();
    await first.getByText("0.25", { exact: true }).waitFor();
    assert.doesNotMatch(await first.locator("body").ariaSnapshot(), /0\.25/);
    const drawing = first.getByRole("status");
    await waitForText(drawing, "Drawing 2 of 3 individuals: 1 has no value on an axis.");
    await shoot(first, engine, "widgets-scatter3d");

    // An edit of an axis's column reaches the window, which fetches it again.
    await cell(grid, "p2", 2).dblclick();
    await grid.getByRole("textbox", { name: "height of p2" }).waitFor();
    await page.keyboard.type("3");
    await page.keyboard.press("Enter");
    await waitForText(drawing, "Drawing all 3 individuals.");

    // A change of role that leaves an axis without a column of numbers
    // closes the window, and the session no longer knows it.
    await grid
      .getByRole("combobox", { name: "Role of height", exact: true })
      .selectOption("category");
    await first.waitForEvent("close");
    assert.deepEqual(app.windows(), ["main"]);
    assert.equal((await subscribe(backend, "scatter3d-1")).error?.kind, "unknownWindow");

    // A window the user closes is forgotten by the session.
    await choose("scatter3d");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Open" }).click();
    const second = await app.window("scatter3d-2");
    await second.waitForFunction(
      () => globalThis.document.title === "3D scatter of seeds, PC1 and seeds",
    );

    // Each point is drawn where the window places it, in its group's colour:
    // p1 and p3 of Spain, orange, p2 of Peru, sky blue.
    const p1 = await steadyPlace(second, 0);
    const p2 = await steadyPlace(second, 1);
    const p3 = await steadyPlace(second, 2);
    await shoot(second, engine, "widgets-points");
    // Each point has an edge in the grey of the box's lines, which stands
    // out from the light background on both sides of it.
    await assertGreyEdges(second, p1, "p1");
    // The GPU snaps a point by up to half a pixel (testing.md).
    await assertDrawnAt(second, p1, [230, 159, 0], "p1");
    await assertDrawnAt(second, p2, [86, 180, 233], "p2");
    await assertDrawnAt(second, p3, [230, 159, 0], "p3");

    // The pointer over a point shows its label: the ID, the group, and the
    // first three other columns.
    await second.mouse.move(p1.x, p1.y);
    const label = second.locator('[aria-hidden="true"]').filter({ hasText: "p1" });
    await label.waitFor();
    assert.match(
      await label.textContent(),
      /p1\s*origin\s*Spain\s*height\s*1\.5\s*seeds\s*10\s*PC1\s*-0\.5/,
    );
    await shoot(second, engine, "widgets-label");

    // The hover went to the backend and came back: p1 is drawn 16 pixels
    // across, so 5 pixels from its centre is its colour, not the background.
    await waitForColour(second, { x: p1.x + 5, y: p1.y }, [230, 159, 0], "p1 hovered");

    // With the pointer still on p1, a change of its group in the main window
    // reaches the label, and so does putting it back.
    const setOrigin = async (group) => {
      await cell(grid, "p1", 1).dblclick();
      const origin = grid.getByRole("combobox", { name: "origin of p1" });
      await origin.fill(group);
      await origin.press("Enter");
      await originSays(grid, "p1", group);
    };
    await setOrigin("Peru");
    await label.filter({ hasText: /origin\s*Peru/ }).waitFor({ timeout: 5000 });
    await setOrigin("Spain");
    await label.filter({ hasText: /origin\s*Spain/ }).waitFor({ timeout: 5000 });

    // A click selects the individual alone; Cmd-click, Ctrl-click outside
    // macOS, adds another.
    await second.mouse.click(p2.x, p2.y);
    await selectedAre(page, ["p2"]);
    // The plot decides a click from its own copy of the selection: each
    // click waits for the ring of a point selected to show what it has,
    // with the pointer off the points.
    await second.mouse.move(5, 5);
    await waitForRing(second, p2, true);
    // mouse.click takes no modifier; the key is held around it.
    await second.keyboard.down("ControlOrMeta");
    await second.mouse.click(p3.x, p3.y);
    await second.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p2", "p3"]);
    await second.mouse.move(5, 5);
    await waitForRing(second, p3, true);
    // Cmd-click on a selected individual takes it away.
    await second.keyboard.down("ControlOrMeta");
    await second.mouse.click(p3.x, p3.y);
    await second.keyboard.up("ControlOrMeta");
    await selectedAre(page, ["p2"]);
    await second.mouse.move(5, 5);
    await waitForRing(second, p3, false);
    // A second click on the one point selected clears the selection, and so
    // does Escape in the plot's window. The plot decides a click and Escape
    // from its own copy of the selection, so each step waits for the ring
    // of the point selected to show what the plot has, with the pointer off
    // the point, whose hover is drawn as large: the main window's table can
    // show a change first.
    await second.mouse.click(p2.x, p2.y);
    await selectedAre(page, []);
    await second.mouse.move(5, 5);
    await waitForRing(second, p2, false);
    await second.mouse.click(p2.x, p2.y);
    await selectedAre(page, ["p2"]);
    await second.mouse.move(5, 5);
    await waitForRing(second, p2, true);
    await second.keyboard.press("Escape");
    await selectedAre(page, []);
    await waitForRing(second, p2, false);
    await second.mouse.click(p2.x, p2.y);
    await selectedAre(page, ["p2"]);
    // Select None's shortcut clears it in a plot window too, where on
    // Windows and Linux the app's menu, the main window's, does not reach.
    await second.mouse.move(5, 5);
    await waitForRing(second, p2, true);
    await second.keyboard.press("ControlOrMeta+Shift+KeyA");
    await selectedAre(page, []);
    await waitForRing(second, p2, false);
    await second.mouse.click(p2.x, p2.y);
    await selectedAre(page, ["p2"]);

    // With + pressed on Peru, a lasso around p1 waits for Enter, which puts
    // p1 in Peru; one around p3 that Escape drops changes nothing.
    const panel = page.getByRole("region", { name: "Groups" });
    await panel.getByRole("button", { name: /^Peru/ }).click();
    const plus = panel.getByRole("button", { name: "Add selected to Peru", exact: true });
    await plus.click();
    await panel.getByRole("button", { name: "Add selected to Peru", pressed: true }).waitFor();
    await lassoAround(second, p1);
    await shoot(second, engine, "widgets-lasso");
    await second.keyboard.press("Enter");
    await originSays(grid, "p1", "Peru");
    await lassoAround(second, p3);
    await second.keyboard.press("Escape");
    await second.keyboard.press("Enter");
    // Releasing + drops a waiting lasso, which Enter then does not apply
    // once + is pressed again.
    await lassoAround(second, p3);
    await plus.click();
    await panel.getByRole("button", { name: "Add selected to Peru", pressed: false }).waitFor();
    await plus.click();
    await panel.getByRole("button", { name: "Add selected to Peru", pressed: true }).waitFor();
    await second.keyboard.press("Enter");
    // The wheel still zooms while + is pressed, and drops a waiting lasso,
    // which Enter then does not apply.
    await lassoAround(second, p3);
    await second.mouse.move(p3.x + 60, p3.y + 60);
    await second.mouse.wheel(0, -300);
    const zoomed = await steadyPlace(second, 2);
    assert.notDeepEqual(zoomed, p3, "the wheel zooms while + is pressed");
    await second.keyboard.press("Enter");
    // A lasso whose pointer the system cancelled, as a touch the web view
    // took for a scroll, is dropped.
    await second.mouse.move(zoomed.x - 20, zoomed.y - 20);
    await second.mouse.down();
    await second.mouse.move(zoomed.x + 20, zoomed.y - 20, { steps: 5 });
    await second.mouse.move(zoomed.x + 20, zoomed.y + 20, { steps: 5 });
    await second.evaluate(() =>
      globalThis.document
        .querySelector(".plot-canvas")
        .dispatchEvent(
          new globalThis.PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
        ),
    );
    await second.mouse.move(zoomed.x - 20, zoomed.y + 20, { steps: 5 });
    await second.mouse.move(zoomed.x - 20, zoomed.y - 20, { steps: 5 });
    await second.mouse.up();
    await second.keyboard.press("Enter");
    await plus.click();
    await panel.getByRole("button", { name: "Add selected to Peru", pressed: false }).waitFor();
    await originSays(grid, "p3", "Spain");

    // With − pressed on Peru, a lasso around p1 takes it out of Peru; Undo
    // puts it back.
    const minus = panel.getByRole("button", { name: "Remove selected from Peru", exact: true });
    await minus.click();
    await panel.getByRole("button", { name: "Remove selected from Peru", pressed: true }).waitFor();
    const p1There = await steadyPlace(second, 0);
    await lassoAround(second, p1There);
    await second.keyboard.press("Enter");
    await cell(grid, "p1", 1).filter({ hasNotText: "Peru" }).waitFor();
    await minus.click();
    await panel
      .getByRole("button", { name: "Remove selected from Peru", pressed: false })
      .waitFor();
    // Edit > Undo chosen while the plot's window is in front undoes the
    // lasso, although the find field of the main window, behind, has the
    // focus there: on macOS the app's menu acts on the main window.
    const field = page
      .getByRole("search", { name: "Find in the table" })
      .getByRole("searchbox", { name: "Find" });
    await field.fill("p");
    await page.evaluate(() => {
      globalThis.document.hasFocus = () => false;
    });
    await choose("undo");
    await originSays(grid, "p1", "Peru");
    assert.equal(await field.inputValue(), "p");
    await page.evaluate(() => {
      delete globalThis.document.hasFocus;
    });
    await field.fill("");

    // A drawing the graphics card lost shows its message until it is drawn again.
    // A lost context gives no extension, so the one fetched before is kept.
    const lose = (what) =>
      second.evaluate((call) => {
        const canvas = globalThis.document.querySelector(".plot-canvas");
        globalThis.__loseContext ??= canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
        globalThis.__loseContext[call]();
      }, what);
    const lostWords = second
      .getByRole("status")
      .filter({ hasText: "The 3D view was lost by the graphics card and is being restored." });
    await lose("loseContext");
    await lostWords.waitFor();
    await lose("restoreContext");
    await lostWords.waitFor({ state: "detached" });
    const p1Now = await steadyPlace(second, 0);
    // p1 is in Peru since the lasso above.
    assertColour(await pixelAt(second, p1Now.x, p1Now.y), [86, 180, 233], "p1 after a restore");

    // With no active classification the points take the theme's colour,
    // and follow the system from light to dark.
    await panel
      .getByRole("combobox", { name: "Classification column" })
      .selectOption({ label: "None" });
    await waitForColour(second, p1Now, [29, 78, 216], "p1 in light");
    await second.emulateMedia({ colorScheme: "dark" });
    await waitForColour(second, p1Now, [143, 176, 255], "p1 in dark");
    await second.emulateMedia({ colorScheme: "light" });

    // The wheel zooms the point away from a pointer that rests where it
    // was: it is no longer the hover, and its label goes.
    await second.mouse.move(p1Now.x, p1Now.y);
    const p1Label = second.locator('[aria-hidden="true"]').filter({ hasText: "p1" });
    await p1Label.waitFor();
    await second.mouse.wheel(0, -600);
    await p1Label.waitFor({ state: "detached", timeout: 5000 });

    // A window left for another, as with Cmd-Tab, gets no more pointer
    // events on macOS: its hover is given up as it loses the focus.
    const p1Zoomed = await steadyPlace(second, 0);
    await second.mouse.move(p1Zoomed.x, p1Zoomed.y);
    await p1Label.waitFor();
    await second.evaluate(() => globalThis.dispatchEvent(new globalThis.Event("blur")));
    await p1Label.waitFor({ state: "detached", timeout: 5000 });

    // The keyboard reaches the plot: the arrows turn it, + zooms, and Home
    // frames the box again.
    const plotByKeys = second.getByRole("application", {
      name: "3D scatter of seeds, PC1 and seeds",
    });
    await plotByKeys.focus();
    await plotByKeys.press("Home");
    const home = await steadyPlace(second, 0);
    await plotByKeys.press("ArrowLeft");
    const turned = await steadyPlace(second, 0);
    assert.ok(Math.hypot(turned.x - home.x, turned.y - home.y) > 5, "ArrowLeft turns the plot");
    await plotByKeys.press("Home");
    const back = await steadyPlace(second, 0);
    assert.ok(Math.hypot(back.x - home.x, back.y - home.y) < 0.5, "Home frames the box again");
    await plotByKeys.press("+");
    const nearer = await steadyPlace(second, 0);
    assert.ok(Math.hypot(nearer.x - home.x, nearer.y - home.y) > 5, "+ zooms");

    // A double click frames the box again, as Home does; the zoom of +
    // above is undone.
    await second.mouse.dblclick(12, 12);
    const framed = await steadyPlace(second, 0);
    await plotByKeys.press("Home");
    const homeAgain = await steadyPlace(second, 0);
    assert.ok(
      Math.hypot(framed.x - nearer.x, framed.y - nearer.y) > 5 &&
        Math.hypot(framed.x - homeAgain.x, framed.y - homeAgain.y) < 0.5,
      `p1 framed again at ${JSON.stringify(framed)}, with Home at ${JSON.stringify(homeAgain)}`,
    );

    // The plot window has the groups panel too, and both panels show one
    // state: a classification or a group chosen in the plot window is chosen
    // in the main window, + pressed there is pressed in both, and the plot
    // window's bar says what pressing it did. The panel has + and − on the
    // group selected, and no Add, Edit or Delete group, which the main
    // window has. The panel can be hidden.
    const plotPanel = second.getByRole("region", { name: "Groups" });
    await plotPanel
      .getByRole("combobox", { name: "Classification column" })
      .selectOption({ label: "origin" });
    await panel.getByRole("button", { name: /^Spain/ }).waitFor();
    await plotPanel.getByRole("button", { name: /^Spain/ }).click();
    await panel.getByRole("button", { name: /^Spain/, pressed: true }).waitFor();
    await plotPanel.getByRole("button", { name: "Remove selected from Spain" }).waitFor();
    for (const name of ["Add group", /^Edit group/, /^Delete group/]) {
      assert.equal(await plotPanel.getByRole("button", { name }).count(), 0, String(name));
    }
    await panel.getByRole("button", { name: "Edit group Spain" }).waitFor();
    const plotPlus = plotPanel.getByRole("button", { name: "Add selected to Spain", exact: true });
    await plotPlus.click();
    await panel.getByRole("button", { name: "Add selected to Spain", pressed: true }).waitFor();
    await second.getByText("1 individual added to Spain.", { exact: false }).waitFor();
    await plotPlus.click();
    await panel.getByRole("button", { name: "Add selected to Spain", pressed: false }).waitFor();
    await second.getByRole("button", { name: "Hide groups" }).click();
    await plotPanel.waitFor({ state: "hidden" });
    await second.getByRole("button", { name: "Show groups" }).click();
    await plotPanel.waitFor();

    await app.closeWindow("scatter3d-2");
    assert.equal((await subscribe(backend, "scatter3d-2")).error?.kind, "unknownWindow");

    // Enter in the dialog opens the 3D scatter, as Open does; a new table
    // closes every widget.
    await choose("scatter3d");
    await dialog.waitFor();
    await x.press("Enter");
    const third = await app.window("scatter3d-3");
    await waitForText(third.getByRole("status"), "Drawing all 3 individuals.");
    const closing = third.waitForEvent("close");
    assert.equal((await backend.send({ command: "e2e:load", table: NO_NUMBERS })).ok, null);
    await closing;
    assert.deepEqual(app.windows(), ["main"]);

    // With no column of numbers, the bar says so and no dialog opens.
    await grid.getByRole("combobox", { name: "Role of note", exact: true }).waitFor();
    await choose("scatter3d");
    const none = page.getByRole("alert").filter({ hasText: "No 3D scatter was opened" });
    await none.waitFor();
    assert.match(
      await none.textContent(),
      /Error:\s*No 3D scatter was opened: the table has no column of numbers\./,
    );
    assert.equal(await dialog.count(), 0);
    await none.getByRole("button", { name: "Dismiss" }).click();
    await none.waitFor({ state: "detached" });

    // Values far from zero and close together are drawn apart: as 32-bit
    // floats the three positions would be one, 4,500,000.
    assert.equal((await backend.send({ command: "e2e:load", table: POSITIONS })).ok, null);
    await grid.getByRole("combobox", { name: "Role of position", exact: true }).waitFor();
    await choose("scatter3d");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Open" }).click();
    const positions = await app.window("scatter3d-4");
    await waitForText(positions.getByRole("status"), "Drawing all 3 individuals.");
    const q1 = await steadyPlace(positions, 0);
    const q2 = await steadyPlace(positions, 1);
    const q3 = await steadyPlace(positions, 2);
    assert.ok(
      Math.hypot(q1.x - q2.x, q1.y - q2.y) > 20,
      `q1 ${JSON.stringify(q1)}, q2 ${JSON.stringify(q2)}`,
    );
    assert.ok(
      Math.hypot(q2.x - q3.x, q2.y - q3.y) > 20,
      `q2 ${JSON.stringify(q2)}, q3 ${JSON.stringify(q3)}`,
    );

    // Where the web view cannot draw WebGL, no window opens and the bar says
    // so; a window that cannot draw although the main window could says it
    // in the place of its plot.
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);
    await grid.getByRole("combobox", { name: "Role of height", exact: true }).waitFor();
    await page.evaluate(() => {
      const canvas = globalThis.HTMLCanvasElement.prototype;
      globalThis.__getContext = canvas.getContext;
      canvas.getContext = function (kind, ...rest) {
        return kind.startsWith("webgl") ? null : globalThis.__getContext.call(this, kind, ...rest);
      };
    });
    await choose("scatter3d");
    await page
      .getByRole("alert")
      .filter({ hasText: "WebGL plots are not supported on this computer." })
      .waitFor();
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(app.windows(), ["main"]);
    await page.evaluate(() => {
      globalThis.HTMLCanvasElement.prototype.getContext = globalThis.__getContext;
    });
    await page.context().addInitScript(() => {
      globalThis.HTMLCanvasElement.prototype.getContext = () => null;
    });
    await choose("scatter3d");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Open" }).click();
    const blind = await app.window("scatter3d-5");
    await blind.getByText("WebGL plots are not supported on this computer.").waitFor();

    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e widgets, ${engine}: passed`);
  } finally {
    await app.close();
  }
}

/**
 * The place of the point of `row` in the window of `plot`, once the camera
 * has stopped moving: a drawn frame can still coast after the framing. It
 * fails after ten seconds, as when the point is never drawn.
 */
async function steadyPlace(plot, row) {
  const placeOf = () => plot.evaluate((r) => globalThis.__vavilovPlot?.placeOf(r) ?? null, row);
  const deadline = Date.now() + 10_000;
  let last = null;
  for (;;) {
    const place = await placeOf();
    if (place !== null && last !== null && place.x === last.x && place.y === last.y) {
      return place;
    }
    assert.ok(Date.now() < deadline, `row ${row} has no steady place: ${JSON.stringify(place)}`);
    last = place;
    await plot.waitForTimeout(100);
  }
}

/**
 * Checks that the row of pixels through `place` has, on each side of the
 * point, a grey pixel darker than the light background: its ring, which the
 * GPU blends with what is beside it.
 */
async function assertGreyEdges(page, place, what) {
  const greyAt = async (dx) => {
    const [red, green, blue] = await pixelAt(page, place.x + dx, place.y);
    return (
      Math.max(red, green, blue) - Math.min(red, green, blue) < 30 &&
      Math.max(red, green, blue) < 200
    );
  };
  for (const side of [-1, 1]) {
    let found = false;
    for (let distance = 2; distance <= 5 && !found; distance += 1) {
      found = await greyAt(side * distance);
    }
    assert.ok(found, `${what}: no grey edge on its ${side < 0 ? "left" : "right"}`);
  }
}

/** Checks that the pixels drawn in `colour` around `place` are centred within 1 pixel of it. */
async function assertDrawnAt(page, place, colour, what) {
  const centre = await centreOfColour(page, place.x, place.y, colour);
  assert.ok(centre !== null, `${what}: no pixel of ${colour} near ${JSON.stringify(place)}`);
  const off = Math.hypot(centre.x - place.x, centre.y - place.y);
  assert.ok(
    off <= 1,
    `${what}: drawn at ${JSON.stringify(centre)}, placed at ${JSON.stringify(place)}`,
  );
}

/** Checks that a pixel is `expected`, within the rounding of the GPU and of the colour spaces. */
function assertColour(pixel, expected, what) {
  const off = pixel.some((value, index) => Math.abs(value - expected[index]) > 12);
  assert.equal(off, false, `${what}: the pixel is ${pixel}, not ${expected}`);
}

/**
 * Waits until the ring of a point selected is, or is not, drawn around the
 * point at `place`: a pixel 4 or 5 pixels left or right of its centre, which
 * falls between pixels, in the dark colour of the text of the light
 * appearance. A point not selected and not hovered has a lighter ring 4
 * pixels out at most.
 */
async function waitForRing(page, place, drawn) {
  const deadline = Date.now() + 5000;
  for (;;) {
    let dark = false;
    for (const dx of [-5, -4, 4, 5]) {
      const [red, green, blue] = await pixelAt(page, place.x + dx, place.y);
      dark ||= red < 90 && green < 90 && blue < 90;
    }
    if (dark === drawn) {
      return;
    }
    assert.ok(
      Date.now() < deadline,
      `the ring of the point selected is ${drawn ? "not " : ""}drawn`,
    );
    await page.waitForTimeout(100);
  }
}

/** Waits, for at most five seconds, until the pixel at `place` is `expected`. */
async function waitForColour(page, place, expected, what) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const pixel = await pixelAt(page, place.x, place.y);
    const off = pixel.some((value, index) => Math.abs(value - expected[index]) > 12);
    if (!off) {
      return;
    }
    assert.ok(Date.now() < deadline, `${what}: the pixel is ${pixel}, not ${expected}`);
    await page.waitForTimeout(100);
  }
}

/** Draws a lasso of a square 40 pixels wide around `place`. */
async function lassoAround(plot, place) {
  const { x, y } = place;
  await plot.mouse.move(x - 20, y - 20);
  await plot.mouse.down();
  for (const [toX, toY] of [
    [x + 20, y - 20],
    [x + 20, y + 20],
    [x - 20, y + 20],
    [x - 20, y - 20],
  ]) {
    await plot.mouse.move(toX, toY, { steps: 5 });
  }
  await plot.mouse.up();
}

/** Waits until the rows of the main window's table drawn as selected are `names`. */
async function selectedAre(page, names) {
  await page.waitForFunction(
    (expected) =>
      JSON.stringify(
        [...globalThis.document.querySelectorAll('[role="row"][aria-selected="true"]')].map((row) =>
          row.querySelector('[role="gridcell"]')?.textContent?.trim(),
        ),
      ) === JSON.stringify(expected),
    names,
  );
}

/** Waits until the cell of origin, the second, of the row of `name` says `text`. */
async function originSays(grid, name, text) {
  await cell(grid, name, 1).filter({ hasText: text }).waitFor();
}

/** The names of the columns chosen on the three axes. */
async function chosen(...axes) {
  return Promise.all(
    axes.map((axis) => axis.evaluate((select) => select.selectedOptions[0]?.textContent ?? "")),
  );
}

/** Subscribes the window `label` as its page would, and gives the answer. */
function subscribe(backend, label) {
  return backend.send({ command: "subscribe", window: label });
}

/** Waits until `locator` says `text`. */
async function waitForText(locator, text) {
  await locator.filter({ hasText: text }).waitFor();
}

/** The cell `index` of the row of `name`. */
function cell(grid, name, index) {
  return grid
    .getByRole("row")
    .filter({ has: grid.page().getByRole("gridcell", { name, exact: true }) })
    .getByRole("gridcell")
    .nth(index);
}

/** Writes `page` in light and in dark, for a person to look at. */
async function shoot(page, engine, name) {
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    // A point view draws the new appearance on its next frame.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
        }),
    );
    await page.screenshot({ path: `${OUT}${name}-${colorScheme}-${engine}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}
