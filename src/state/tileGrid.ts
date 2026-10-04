// How a window of tiles arranges them by their number, as the owner decided
// on 4 October 2026 (docs/design.md, section 2.2).

/** The grid of a window's tiles, and where its groups panel goes. */
export interface TileGrid {
  /** The columns of tiles, 1 or 2. */
  readonly columns: number;
  /** The rows of tiles. */
  readonly rows: number;
  /**
   * Whether the groups panel takes the empty place at the end of the last
   * row, rather than a column at the window's right.
   */
  readonly panelInGrid: boolean;
}

/**
 * The grid of `count` tiles, in the order they were opened, row by row: one
 * fills the window, two or three are stacked, four make two rows of two,
 * and five or six, as many as a window holds, two columns in three rows. With
 * five the last row has an empty place, which the groups panel
 * takes.
 */
export function tileGrid(count: number): TileGrid {
  if (count <= 3) {
    return { columns: 1, rows: Math.max(count, 1), panelInGrid: false };
  }
  return { columns: 2, rows: Math.ceil(count / 2), panelInGrid: count > 4 && count % 2 === 1 };
}
