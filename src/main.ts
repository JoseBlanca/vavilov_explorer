// The entry of every window: it starts the window this page belongs to.

import { startWindow } from "./windows/startWindow.ts";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("Vavilov Explorer defect: index.html without its #app");
}
startWindow(root).catch((error: unknown) => {
  // Before the bar of a defect exists, the console is all there is.
  console.error(error);
});
