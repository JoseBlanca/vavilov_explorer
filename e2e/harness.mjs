// Runs the real frontend in WebKit, the engine of Tauri on macOS and
// Linux, or in Chromium, the engine of WebView2 on Windows, with only
// Tauri's IPC replaced. Either each test says what each command returns,
// and a command it did not mention fails loudly; or, with `backend: true`,
// every call goes to the test program of crates/vavilov-e2e-backend, which
// runs the real core and the app's own reading of each call, and its
// channel messages come back to the page as Tauri delivers them.
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

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
export async function launch({
  engine,
  commands = {},
  backend: withBackend = false,
  viewport = { width: 1400, height: 900 },
}) {
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

  const backend = withBackend ? await startBackend() : null;
  if (backend === null) {
    await page.addInitScript((replies) => {
      globalThis.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        invoke: async (cmd) => {
          if (!(cmd in replies)) throw new Error(`e2e: no mocked reply for Tauri command "${cmd}"`);
          return structuredClone(replies[cmd]);
        },
        transformCallback: () => 0,
      };
    }, commands);
  } else {
    await connectPage(page, backend, errors);
  }

  await page.goto(`http://localhost:${PORT}`);
  return {
    page,
    errors,
    backend,
    async close() {
      await browser.close();
      await server.close();
      backend?.close();
    },
  };
}

/**
 * Builds and starts the test program. `send` writes one line and resolves
 * with its answer; `onChannel` is called with each channel message, in the
 * order the program sent them.
 */
async function startBackend() {
  execFileSync("cargo", ["build", "--quiet", "-p", "vavilov-e2e-backend"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  const child = spawn(`${ROOT}target/debug/vavilov-e2e-backend`, [], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  const listeners = [];
  let nextId = 1;
  readline.createInterface({ input: child.stdout }).on("line", (text) => {
    const line = JSON.parse(text);
    if ("message" in line) {
      for (const listener of listeners) listener(line.window, line.message);
      return;
    }
    const resolve = pending.get(line.id);
    if (resolve === undefined) throw new Error(`e2e: an answer to no call: ${text}`);
    pending.delete(line.id);
    resolve(line);
  });
  return {
    send(call) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ id, ...call })}\n`);
      });
    },
    onChannel(listener) {
      listeners.push(listener);
    },
    close() {
      child.stdin.end();
    },
  };
}

/**
 * Gives the page Tauri's internals as `@tauri-apps/api` calls them, over
 * the test program: `invoke` sends the call, a JSON body or raw bytes with
 * headers, and resolves or rejects as Tauri does; each channel message is
 * passed to the channel's callback with the index Tauri numbers them by.
 */
async function connectPage(page, backend, errors) {
  // Tauri numbers the messages of each channel from 0, and a subscribe
  // brings a new channel.
  let index = 0;
  await page.exposeFunction("__e2eCall", (call) => {
    if (call.command === "subscribe") index = 0;
    return backend.send({ window: "main", ...call });
  });
  await page.addInitScript(() => {
    const callbacks = new Map();
    let nextCallback = 1;
    globalThis.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: (callback) => {
        const id = nextCallback++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id) => callbacks.delete(id),
      invoke: async (command, args = {}, options = {}) => {
        let call;
        if (command === "subscribe") {
          // A Channel is passed as "__CHANNEL__:<id>", its toJSON.
          const channel = JSON.parse(JSON.stringify(args.onChange));
          globalThis.__e2eChannel = Number(channel.split(":")[1]);
          call = { command };
        } else if (args instanceof Uint8Array) {
          call = { command, raw: Array.from(args), headers: options.headers ?? {} };
        } else {
          call = { command, json: args };
        }
        const answer = await globalThis.__e2eCall(call);
        if ("e2e" in answer) throw new Error(`e2e: ${answer.e2e}`);
        if ("error" in answer) throw answer.error;
        if ("bytes" in answer) return new Uint8Array(answer.bytes).buffer;
        return answer.ok;
      },
    };
    globalThis.__e2eDeliver = (index, bytes) => {
      const callback = callbacks.get(globalThis.__e2eChannel);
      if (callback === undefined) throw new Error("e2e: a channel message before the subscribe");
      callback({ index, message: new Uint8Array(bytes).buffer });
    };
  });
  let delivery = Promise.resolve();
  backend.onChannel((_window, message) => {
    const at = index++;
    delivery = delivery
      .then(() =>
        page.isClosed()
          ? undefined
          : page.evaluate(([i, m]) => globalThis.__e2eDeliver(i, m), [at, message]),
      )
      .catch((error) => {
        // A page closed while a message was on its way has nothing to show.
        if (!page.isClosed()) errors.push(`e2e: a channel message not delivered: ${error}`);
      });
  });
}
