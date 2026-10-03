import { describe, expect, test } from "vitest";

import type { ColumnNumbers } from "../../state/columnNumbers.ts";
import { defect } from "../../state/defect.ts";
import { isColumnId, isRevision } from "../../state/ids.ts";
import type { ColumnId, Revision } from "../../state/ids.ts";
import type { AxisColumnsSource } from "./axisColumns.ts";
import { createAxisColumns } from "./axisColumns.ts";

function columnId(value: number): ColumnId {
  if (!isColumnId(value)) {
    throw defect(`no column ${String(value)}`);
  }
  return value;
}

function revision(value: number): Revision {
  if (!isRevision(value)) {
    throw defect(`no revision ${String(value)}`);
  }
  return value;
}

const HEIGHT = columnId(4);

/**
 * A backend whose column `height` is at `backendAt`, and a copy at
 * `copyAt`, which a test moves as the message of a change arrives; it
 * counts the fetches, and answers "stale" when `stale` is set.
 */
function source(backendAt: number, copyAt: number, stale = false) {
  const world = { backendAt, copyAt, stale, fetches: 0 };
  const answer = (): ColumnNumbers => ({
    column: HEIGHT,
    revision: revision(world.backendAt),
    centre: 0,
    values: new Float32Array([1.5, 2]),
    missing: new Uint8Array(1),
  });
  const given: AxisColumnsSource = {
    fetchColumn: (column) => {
      world.fetches += 1;
      if (world.fetches > 10) {
        return Promise.reject(new Error("fetched more than ten times"));
      }
      expect(column).toBe(HEIGHT);
      return Promise.resolve({ ok: true, value: world.stale ? "stale" : answer() });
    },
    state: { columnRevision: () => revision(world.copyAt) },
  };
  return { world, given };
}

describe("createAxisColumns", () => {
  test("a column fetched at the copy's revision is fetched once and is current", async () => {
    const { world, given } = source(3, 3);
    const columns = createAxisColumns(given, [HEIGHT, HEIGHT, HEIGHT], () => undefined);
    await columns.refresh();
    expect(world.fetches).toBe(1);
    expect(columns.current()?.map((axis) => axis.revision)).toEqual([3, 3, 3]);
  });

  test("an answer ahead of the copy is fetched once, and is current when the copy reaches it", async () => {
    const { world, given } = source(5, 4);
    const columns = createAxisColumns(given, [HEIGHT, HEIGHT, HEIGHT], () => undefined);
    await columns.refresh();
    expect(world.fetches).toBe(1);
    expect(columns.current()).toBe(null);
    world.copyAt = 5;
    await columns.refresh();
    expect(world.fetches).toBe(1);
    expect(columns.current()?.map((axis) => axis.revision)).toEqual([5, 5, 5]);
  });

  test("an answer for a table replaced since the copy is not fetched again", async () => {
    const { world, given } = source(3, 3, true);
    const columns = createAxisColumns(given, [HEIGHT, HEIGHT, HEIGHT], () => undefined);
    await columns.refresh();
    expect(world.fetches).toBe(1);
    expect(columns.current()).toBe(null);
  });

  test("a column the copy moved past while it was on its way is fetched again", async () => {
    const { world, given } = source(3, 3);
    const columns = createAxisColumns(given, [HEIGHT, HEIGHT, HEIGHT], () => {
      if (world.fetches === 1) {
        world.backendAt = 6;
        world.copyAt = 6;
      }
    });
    await columns.refresh();
    expect(world.fetches).toBe(2);
    expect(columns.current()?.map((axis) => axis.revision)).toEqual([6, 6, 6]);
  });
});
