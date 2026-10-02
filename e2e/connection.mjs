// The window's connection (src/backend/connection.ts) against the real
// core, through the test program behind the harness, in each engine: every
// command a window sends, a refusal, and the changes coming back on the
// channel. A name that drifts between the TypeScript and the app, of a
// command or of an argument, fails here.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, launch } from "./harness.mjs";

/** Four plants, `origin` (Spain, Peru) as column 1, active. */
const PLANTS = {
  header: "accession",
  names: ["p1", "p2", "p3", "p4"],
  columns: [
    {
      name: "origin",
      levels: [
        ["Spain", [230, 159, 0]],
        ["Peru", [86, 180, 233]],
      ],
      codes: [0, 1, null, 0],
    },
    { name: "height", numeric: [1.5, null, 2, 3.25] },
  ],
  activeClassification: 1,
};

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine, backend: true });
  try {
    const { page, errors, backend } = app;
    assert.equal((await backend.send({ command: "e2e:load", table: PLANTS })).ok, null);

    await page.evaluate(async () => {
      const { connect } = await import("/src/backend/connection.ts");
      const { tauriTransport } = await import("/src/backend/transport.ts");
      globalThis.__defects = [];
      globalThis.__connection = await connect(tauriTransport(), (error) => {
        globalThis.__defects.push(error.message);
      });
    });

    /** Calls a method of the connection in the page and returns its answer. */
    const send = (method, ...args) =>
      page.evaluate(
        ([name, values]) =>
          globalThis.__connection[name](
            ...values.map((value) =>
              value !== null && typeof value === "object" && "bytes" in value
                ? new Uint8Array(value.bytes)
                : value,
            ),
          ),
        [method, args],
      );
    /** The window's copy, once it has reached `revision`. */
    const stateAt = async (revision) => {
      await page.waitForFunction((r) => globalThis.__connection.state.revision() >= r, revision);
      return page.evaluate(() => {
        const state = globalThis.__connection.state;
        return {
          revision: state.revision(),
          active: state.active(),
          codes: [...(state.codes(1) ?? [])],
          selection: [...(state.selection() ?? [])],
          hover: state.hover(),
          undoRedo: state.undoRedo(),
        };
      });
    };
    const applied = { ok: true, value: "applied" };
    const rows = (bits) => ({ bytes: [bits] });

    assert.equal((await stateAt(1)).revision, 1);
    const peru = { kind: "population", code: 1 };
    const description = await page.evaluate(() => globalThis.__connection.describeTable());
    assert.deepEqual(
      description.value.columns.map((column) => [column.name, column.type]),
      [
        ["origin", "categorical"],
        ["height", "numeric"],
      ],
    );
    assert.deepEqual(await send("selectPopulation", 1, peru), applied);
    assert.deepEqual((await stateAt(2)).active, { column: 1, selected: peru });
    // Rows 2 and 3 into Peru.
    assert.deepEqual(await send("assignRows", 1, peru, rows(0b1100)), applied);
    assert.deepEqual((await stateAt(3)).codes, [0, 1, 1, 1]);
    // Rows 0 to 2 out of Peru: rows 1 and 2 are in it, row 0 is in Spain.
    assert.deepEqual(await send("unassignRows", 1, 1, rows(0b0111)), applied);
    assert.deepEqual((await stateAt(4)).codes, [0, 0xffff, 0xffff, 1]);
    assert.deepEqual(await send("undo"), applied);
    assert.deepEqual((await stateAt(5)).codes, [0, 1, 1, 1]);
    assert.deepEqual(await send("redo"), applied);
    assert.deepEqual((await stateAt(6)).undoRedo, { canUndo: true, canRedo: false });
    // A lasso for Spain while Peru is selected is refused, as a value.
    assert.deepEqual(await send("assignRows", 1, { kind: "population", code: 0 }, rows(0b0001)), {
      ok: false,
      error: { kind: "notSelected", target: { population: 0 } },
    });
    assert.deepEqual(await send("setSelection", rows(0b0110)), applied);
    assert.deepEqual((await stateAt(7)).selection, [0b0110]);
    // The unassigned individuals selected, a lasso of row 3 unassigns it.
    assert.deepEqual(await send("selectPopulation", 1, { kind: "unassigned" }), applied);
    assert.deepEqual(await send("assignRows", 1, { kind: "unassigned" }, rows(0b1000)), applied);
    assert.deepEqual((await stateAt(9)).codes, [0, 0xffff, 0xffff, 0xffff]);
    assert.deepEqual(await send("setActiveClassification", null), applied);
    assert.equal((await stateAt(10)).active, null);
    assert.deepEqual(await send("setHover", 2), applied);
    await page.waitForFunction(() => globalThis.__connection.state.hover() === 2);

    assert.deepEqual(await page.evaluate(() => globalThis.__defects), []);
    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e connection, ${engine}: passed`);
  } finally {
    await app.close();
  }
}
