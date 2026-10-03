// Runs the real frontend in WebKit, the engine of Tauri on macOS and
// Linux, or in Chromium, the engine of WebView2 on Windows, with only
// Tauri's IPC replaced. Either each test says what each command returns,
// and a command it did not mention fails loudly; or, with `backend: true`,
// every call goes to the test program of crates/vavilov-e2e-backend, which
// runs the real core and the app's own reading of each call, and its
// channel messages come back to the page as Tauri delivers them. With the
// test program each window is a page of one browser, with its window's
// label: the main window's page first, and a page for each widget the
// program asks the harness to open.
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

// A path of the file system, not of a URL, so that a folder with a space
// or a drive letter on Windows is written as the system writes it.
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUT = path.join(ROOT, "e2e", "output") + path.sep;

// Away from 1420, which `npm run tauri dev` uses, so both can run at once;
// E2E_PORT gives each reviewer in a worktree a port of its own
// (.claude/skills/code-review/SKILL.md).
const PORT = Number(process.env.E2E_PORT ?? 1430);
if (!Number.isInteger(PORT) || PORT <= 0)
  throw new Error(`e2e: E2E_PORT is not a port: ${process.env.E2E_PORT}`);

/** The engines every e2e test runs in. */
export const ENGINES = { webkit, chromium };

/** The size of a widget's page, the size the app opens its window at (src-tauri/src/windows.rs). */
const WIDGET_VIEWPORT = { width: 800, height: 640 };

/**
 * Starts the dev server and a page with the app loaded, in `engine`, one of
 * the keys of ENGINES. `commands` maps a Tauri command name to the value
 * its invoke resolves to. `locale`, such as "es-ES", is the language of the
 * page; without it the page takes the machine's. `region`, with the test
 * program, is the decimal mark of the system's region, which sets how
 * numbers are written and how a CSV starts; "." unless given, so that a
 * test does not depend on the machine's region.
 *
 * With the test program, `window(label)` resolves with the page of a
 * widget's window once the program has asked for it, and fails when it has
 * not within 10 seconds; and `closeWindow(label)`
 * closes a page as the user closes a window; `windows()` gives the labels of
 * the pages open.
 */
export async function launch({
  engine,
  commands = {},
  backend: withBackend = false,
  viewport = { width: 1400, height: 900 },
  locale,
  region = ".",
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
  const context = await browser.newContext(locale === undefined ? {} : { locale });
  const page = await context.newPage();
  await page.setViewportSize(viewport);

  const errors = [];
  const watch = (watched) => {
    watched.on("pageerror", (e) => errors.push(String(e)));
    watched.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  };
  watch(page);

  const backend = withBackend ? await startBackend() : null;
  const windows = backend === null ? null : connectWindows(context, backend, errors, watch);
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
    await windows.add("main", page);
    const set = await backend.send({ command: "e2e:region", decimalMark: region });
    if (set.ok !== null) throw new Error(`e2e: the region was not set: ${JSON.stringify(set)}`);
  }

  await page.goto(`http://localhost:${PORT}`);
  return {
    page,
    errors,
    backend,
    window: (label) => windows.page(label),
    closeWindow: (label) => windows.close(label),
    windows: () => windows.labels(),
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
 * order the program sent them; `onWindow` with each page of a window the
 * program asks to open, `{ open: label, widget }`, or to close, `{ close:
 * label }`, in the order it asked.
 */
async function startBackend() {
  const child = spawn(buildBackend(), [], { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  const listeners = [];
  const windowListeners = [];
  let nextId = 1;
  readline.createInterface({ input: child.stdout }).on("line", (text) => {
    const line = JSON.parse(text);
    if ("message" in line) {
      for (const listener of listeners) listener(line.window, line.message);
      return;
    }
    if ("open" in line || "close" in line) {
      for (const listener of windowListeners) listener(line);
      return;
    }
    const waiting = pending.get(line.id);
    if (waiting === undefined) throw new Error(`e2e: an answer to no call: ${text}`);
    pending.delete(line.id);
    waiting.resolve(line);
  });
  // A program that ends or fails to start fails every call still waiting,
  // and every later one, so that the test fails rather than waits forever.
  let ended = null;
  const end = (reason) => {
    ended ??= new Error(`e2e: the test program ${reason}`);
    for (const [, { reject }] of pending) reject(ended);
    pending.clear();
  };
  child.on("exit", (code, signal) => end(`ended, with ${signal ?? `code ${code}`}`));
  child.on("error", (error) => end(`failed: ${error.message}`));
  return {
    send(call) {
      if (ended !== null) return Promise.reject(ended);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ id, ...call })}\n`);
      });
    },
    onChannel(listener) {
      listeners.push(listener);
    },
    onWindow(listener) {
      windowListeners.push(listener);
    },
    close() {
      child.stdin.end();
    },
  };
}

/**
 * Builds the test program and gives the path of its executable, as cargo
 * reports it, wherever the target folder is and whatever the platform
 * names an executable.
 */
function buildBackend() {
  const output = execFileSync(
    "cargo",
    ["build", "--quiet", "--message-format=json", "-p", "vavilov-e2e-backend"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 1 << 26 },
  );
  for (const text of output.split("\n")) {
    if (text === "") continue;
    const message = JSON.parse(text);
    if (message.reason === "compiler-artifact" && message.target.name === "vavilov-e2e-backend") {
      if (typeof message.executable === "string") return message.executable;
    }
  }
  throw new Error("e2e: cargo built no executable of vavilov-e2e-backend");
}

/**
 * The pages of the windows, by label, over the test program: each page
 * gets Tauri's internals with its window's label, each channel message goes
 * to the page of its window, and a page is opened or closed when the program
 * asks, as the app opens or closes a window.
 */
function connectWindows(context, backend, errors, watch) {
  /** The page of each window open, and its channel's delivery. */
  const pages = new Map();
  /** The tests waiting for a window, by label. */
  const waiting = new Map();
  /** The opening and closing of pages, one after the other, in the order asked. */
  let changes = Promise.resolve();

  const add = async (label, page) => {
    const window = { page, index: 0, delivery: Promise.resolve() };
    pages.set(label, window);
    await connectPage(page, label, backend, () => {
      // Tauri numbers the messages of each channel from 0, and a subscribe
      // brings a new channel.
      window.index = 0;
    });
    for (const resolve of waiting.get(label) ?? []) resolve(page);
    waiting.delete(label);
  };

  const close = async (label) => {
    const window = pages.get(label);
    if (window === undefined) return;
    pages.delete(label);
    await window.page.close();
    // As Tauri tells the app that a window was destroyed.
    const closed = await backend.send({ command: "e2e:closed", window: label });
    if (closed.ok !== null) errors.push(`e2e: closing ${label}: ${JSON.stringify(closed)}`);
  };

  backend.onChannel((label, message) => {
    const window = pages.get(label);
    if (window === undefined) {
      errors.push(`e2e: a channel message for window ${label}, which has no page`);
      return;
    }
    const at = window.index++;
    const { page } = window;
    window.delivery = window.delivery
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

  backend.onWindow((line) => {
    changes = changes
      .then(async () => {
        if ("close" in line) {
          await close(line.close);
          return;
        }
        const page = await context.newPage();
        await page.setViewportSize(WIDGET_VIEWPORT);
        watch(page);
        await add(line.open, page);
        await page.goto(`http://localhost:${PORT}`);
      })
      .catch((error) => errors.push(`e2e: a window not opened or closed: ${error}`));
  });

  return {
    add,
    close: (label) => {
      changes = changes.then(() => close(label));
      return changes;
    },
    page: (label) => {
      const open = pages.get(label);
      if (open !== undefined) return Promise.resolve(open.page);
      return new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
          reject(new Error(`e2e: no window ${label} opened in 10 s`));
        }, 10_000);
        const opened = (page) => {
          globalThis.clearTimeout(timer);
          resolve(page);
        };
        waiting.set(label, [...(waiting.get(label) ?? []), opened]);
      });
    },
    labels: () => [...pages.keys()],
  };
}

/**
 * Gives the page of the window `label` Tauri's internals as
 * `@tauri-apps/api` calls them, over the test program: `invoke` sends the
 * call, a JSON body or raw bytes with headers, and resolves or rejects as
 * Tauri does; each channel message is passed to the channel's callback with
 * the index Tauri numbers them by. `onSubscribe` is called as the page
 * subscribes, which brings a new channel.
 */
async function connectPage(page, label, backend, onSubscribe) {
  await page.exposeFunction("__e2eCall", (call) => {
    if (call.command === "subscribe") onSubscribe();
    return backend.send({ window: label, ...call });
  });
  await page.addInitScript((windowLabel) => {
    const callbacks = new Map();
    let nextCallback = 1;
    globalThis.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: windowLabel },
        currentWebview: { label: windowLabel },
      },
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
  }, label);
}
