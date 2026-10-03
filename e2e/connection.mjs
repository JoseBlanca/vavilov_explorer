// The window's connection (src/backend/connection.ts) against the real
// core, through the test program behind the harness, in each engine: every
// command a window sends, a refusal, and the changes coming back on the
// channel. A name that drifts between the TypeScript and the app, of a
// command or of an argument, fails here.
//
// Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { ENGINES, launch } from "./harness.mjs";

/**
 * Four plants, `origin` (Spain, Peru) as column 1, active, then 2 `height`,
 * 3 `seeds`, 4 `fertile` and 5 `note`.
 */
const PLANTS = {
  header: "IndividualID",
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
    { name: "seeds", integer: [10, 12, null, -7] },
    { name: "fertile", boolean: [true, false, null, true] },
    { name: "note", text: ["NA", null, "tall", "Ñandú"] },
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
    const peru = { kind: "group", code: 1 };
    const description = await page.evaluate(() => globalThis.__connection.describeTable());
    assert.deepEqual(
      description.value.columns.map((column) => [column.name, column.storage, column.role]),
      [
        ["origin", "text", "category"],
        ["height", "float", "number"],
        ["seeds", "integer", "number"],
        ["fertile", "boolean", "category"],
        ["note", "text", "text"],
      ],
    );
    /** A page of rows, its integers as text, which a page cannot return. */
    const fetchRows = (first, count, columns) =>
      page.evaluate(
        async ([f, c, ids]) =>
          JSON.parse(
            JSON.stringify(await globalThis.__connection.fetchRows(f, c, ids), (_, value) =>
              typeof value === "bigint" ? `${String(value)}n` : value,
            ),
          ),
        [first, count, columns],
      );
    assert.deepEqual(await fetchRows(1, 3, [5, 2, 3, 4, 1]), {
      ok: true,
      value: {
        revision: 1,
        loadedAt: 1,
        shownAt: 1,
        namesAt: 1,
        rows: [1, 2, 3],
        first: 1,
        count: 3,
        names: ["p2", "p3", "p4"],
        columns: [
          { id: 5, revision: 1, type: "text", values: [null, "tall", "Ñandú"] },
          { id: 2, revision: 1, type: "float", values: [null, 2, 3.25] },
          { id: 3, revision: 1, type: "integer", values: ["12n", null, "-7n"] },
          // fertile, a category of yes or no, FALSE before TRUE, as codes.
          { id: 4, revision: 1, type: "categorical", codes: [0, null, 1] },
          { id: 1, revision: 1, type: "categorical", codes: [1, null, 0] },
        ],
      },
    });
    assert.deepEqual(await fetchRows(3, 2, []), {
      ok: false,
      error: { kind: "rowsOutOfRange", first: 3, count: 2, numShown: 4 },
    });
    assert.deepEqual(await send("selectGroups", 1, [peru]), applied);
    assert.deepEqual((await stateAt(2)).active, { column: 1, selected: [peru], mode: null });
    // Rows 2 and 3 into Peru.
    assert.deepEqual(await send("assignRows", 1, peru, rows(0b1100)), applied);
    assert.deepEqual((await stateAt(3)).codes, [0, 1, 1, 1]);
    // Rows 0 to 2 out of Peru: rows 1 and 2 are in it, row 0 is in Spain.
    assert.deepEqual(await send("unassignRows", 1, [peru], rows(0b0111)), applied);
    assert.deepEqual((await stateAt(4)).codes, [0, 0xffff, 0xffff, 1]);
    assert.deepEqual(await send("undo"), applied);
    assert.deepEqual((await stateAt(5)).codes, [0, 1, 1, 1]);
    assert.deepEqual(await send("redo"), applied);
    assert.deepEqual((await stateAt(6)).undoRedo, { canUndo: true, canRedo: false });
    // A lasso for Spain while Peru is selected is refused, as a value.
    assert.deepEqual(await send("assignRows", 1, { kind: "group", code: 0 }, rows(0b0001)), {
      ok: false,
      error: { kind: "notSelected" },
    });
    assert.deepEqual(await send("setSelection", rows(0b0110)), applied);
    assert.deepEqual((await stateAt(7)).selection, [0b0110]);
    // The unassigned individuals selected, a lasso of row 3 unassigns it.
    assert.deepEqual(await send("selectGroups", 1, [{ kind: "unassigned" }]), applied);
    assert.deepEqual(await send("assignRows", 1, { kind: "unassigned" }, rows(0b1000)), applied);
    assert.deepEqual((await stateAt(9)).codes, [0, 0xffff, 0xffff, 0xffff]);
    assert.deepEqual(await send("setActiveClassification", null), applied);
    assert.equal((await stateAt(10)).active, null);
    assert.deepEqual(await send("setHover", 2), applied);
    await page.waitForFunction(() => globalThis.__connection.state.hover() === 2);

    // seeds made a category, then refused as text, which numbers cannot be.
    assert.deepEqual(await send("setRole", 3, "category"), applied);
    await stateAt(11);
    assert.deepEqual(
      await page.evaluate(() => [...(globalThis.__connection.state.codes(3) ?? [])]),
      [1, 2, 0xffff, 0],
    );
    assert.deepEqual(await send("setRole", 3, "text"), {
      ok: false,
      error: { kind: "roleNotPossible", column: 3, storage: "integer", role: "text" },
    });

    // The rows whose note is not the whole of "tall": 0, 1, whose note is
    // missing and never matches, and 3.
    const tall = { text: "tall", column: 5, cell: "whole", showing: "notMatching" };
    assert.deepEqual(await send("setFilter", tall, ","), applied);
    await stateAt(12);
    assert.deepEqual(
      await page.evaluate(() => {
        const state = globalThis.__connection.state;
        const shown = state.shown();
        return { filter: state.filter(), numShown: shown.numShown, bits: [...shown.bits] };
      }),
      { filter: tall, numShown: 3, bits: [0b1011] },
    );

    assert.deepEqual(await page.evaluate(() => globalThis.__defects), []);
    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e connection, ${engine}: passed`);
  } finally {
    await app.close();
  }
}
