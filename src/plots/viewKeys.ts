// How far the keys move a plot whose view pans and zooms, the maps' and the
// 2D scatter's, and zoom the 3D scatter's camera, so that a key does the
// same in every plot (docs/design.md, section 2.2).

/** How far an arrow key moves the view, as a share of it. */
export const KEY_PAN = 0.1;
/** How many times nearer + brings the view, and − takes it further. */
export const KEY_ZOOM = 1.25;
