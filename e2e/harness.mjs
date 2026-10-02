// Runs the real frontend in WebKit, the engine of Tauri on macOS and
// Linux, or in Chromium, the engine of WebView2 on Windows, with only
// Tauri's IPC mocked: each test says what each command returns, and a
// command it did not mention fails loudly.
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import fs from "node:fs";

export const ROOT = new URL("..", import.meta.url).pathname;
export const OUT = ROOT + "e2e/output/";

// Away from 1420, which `npm run tauri dev` uses, so both can run at once;
// E2E_PORT gives each reviewer in a worktree a port of its own
// (.claude/skills/code-review/SKILL.md).
const PORT = Number(process.env.E2E_PORT ?? 1430);
if (!Number.isInteger(PORT) || PORT <= 0)
  throw new Error(`e2e: E2E_PORT is not a port: ${process.env.E2E_PORT}`);

/** The engines every e2e test runs in. */
export const ENGINES = { webkit, chromium };

/**
 * Starts the dev server and a page with the app loaded, in `engine`, one of
 * the keys of ENGINES. `commands` maps a Tauri command name to the value
 * its invoke resolves to.
 */
export async function launch({ engine, commands = {}, viewport = { width: 1400, height: 900 } }) {
  const browserType = ENGINES[engine];
  if (browserType === undefined) throw new Error(`e2e: no engine "${engine}"`);
  fs.mkdirSync(OUT, { recursive: true });
  const server = await createServer({
    root: ROOT,
    server: { port: PORT, strictPort: true },
    logLevel: "warn",
  });
  await server.listen();
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.addInitScript((replies) => {
    globalThis.__TAURI_INTERNALS__ = {
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
