// The app loads without errors, in each engine of the harness.
//
// Run with `npm run test:e2e`; screenshots land in e2e/output/.
import assert from "node:assert/strict";
import { ENGINES, OUT, launch } from "./harness.mjs";

for (const engine of Object.keys(ENGINES)) {
  const app = await launch({ engine });
  try {
    const { page, errors } = app;
    assert.equal(await page.title(), "Vavilov Explorer");
    assert.equal(await page.textContent("h1"), "Vavilov Explorer");
    await page.screenshot({ path: `${OUT}smoke-${engine}.png` });
    assert.deepEqual(errors, [], "no page errors");
    console.log(`e2e smoke, ${engine}: passed`);
  } finally {
    await app.close();
  }
}
