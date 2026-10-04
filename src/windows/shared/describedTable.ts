import type { Connection } from "../../backend/connection.ts";
import { defect } from "../../state/defect.ts";
import type { DescriptionNow, TableDescription } from "../../state/description.ts";

/** The description of the table a plot window keeps, and when it is that of its copy. */
export interface DescribedTable {
  /** The description, when it is that of the copy's load and shape, or `null`. */
  readonly current: () => TableDescription | null;
  /** The description as the groups panel takes it: none, behind the copy, or current. */
  readonly now: () => DescriptionNow;
  /** Asks the backend for the description, keeps it and returns it. */
  readonly fetch: () => Promise<TableDescription>;
}

/**
 * The description of the table of a plot window's `connection`, asked for
 * again by the window when the copy's table changes. A plot window has a
 * table: the backend closes it when none is open.
 */
export function createDescribedTable(connection: Connection): DescribedTable {
  const { state } = connection;
  let description: TableDescription | null = null;
  const current = (): TableDescription | null => {
    const project = state.project();
    if (
      project.kind === "noProject" ||
      description?.loadedAt !== project.loadedAt ||
      description.shapeAt !== state.shapeAt()
    ) {
      return null;
    }
    return description;
  };
  return {
    current,
    now: () => {
      if (state.project().kind === "noProject") {
        return { kind: "none" };
      }
      const now = current();
      return now === null ? { kind: "behind" } : { kind: "current", description: now };
    },
    fetch: async () => {
      const answer = await connection.describeTable();
      if (!answer.ok) {
        throw defect(`a plot with no table to describe: ${answer.error.kind}`);
      }
      description = answer.value;
      return answer.value;
    },
  };
}
