// The app loads in WebKit without errors.
//
// Run with `npm run test:e2e`; screenshots land in e2e/output/.
import assert from "node:assert/strict";
import { OUT, launch } from "./harness.mjs";

const app = await launch();
try {
  const { page, errors } = app;
  assert.equal(await page.title(), "Vavilov Explorer");
  assert.equal(await page.textContent("h1"), "Vavilov Explorer");
  await page.screenshot({ path: OUT + "smoke.png" });
  assert.deepEqual(errors, [], "no page errors");
  console.log("e2e smoke: passed");
} finally {
  await app.close();
}
