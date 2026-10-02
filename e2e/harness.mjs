// Runs the real frontend in WebKit, the engine Tauri uses on macOS, with
// only Tauri's IPC mocked: each test says what each command returns, and
// a command it did not mention fails loudly.
import { webkit } from "playwright";
import { createServer } from "vite";
import fs from "node:fs";

export const ROOT = new URL("..", import.meta.url).pathname;
export const OUT = ROOT + "e2e/output/";

// Away from 1420, which `npm run tauri dev` uses, so both can run at once.
const PORT = 1430;

/**
 * Starts the dev server and a page with the app loaded. `commands` maps a
 * Tauri command name to the value its invoke resolves to.
 */
export async function launch({ commands = {}, viewport = { width: 1400, height: 900 } } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "warn" });
  await server.listen();
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.addInitScript((replies) => {
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (!(cmd in replies)) throw new Error(`e2e: no mocked reply for Tauri command "${cmd}"`);
        return structuredClone(replies[cmd]);
      },
      transformCallback: () => 0,
    };
  }, commands);

  await page.goto(`http://localhost:${PORT}`);
  return {
    page,
    errors,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}
