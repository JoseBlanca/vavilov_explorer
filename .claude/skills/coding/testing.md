# Testing

How Vavilov Explorer is tested: which kind of test covers which part,
how the windows are tested without the real app and with it, how a
session sees the windows it changed, and what the tests must show before
the work is called done. The layers are those of `docs/design.md`,
section 11. The rules of `SKILL.md` hold: the test comes first and fails
on its assertion before the change, its expected values are literals, and
a check that could not be run is reported as not run.

## Which test covers what

| part | tool | where it runs | what it checks |
|---|---|---|---|
| the core: table, session, commands, undo, project file, import and export | `cargo test` | `crates/vavilov-core` | the rules of the data, every refusal, the revisions, the atomic subscribe, the hover's sequence number |
| the commands of the app | `cargo test`, with Tauri's mock runtime | `src-tauri` | every command is registered, finds its state, and serialises its errors as `tauri.md` says |
| the window's state, the decoding of messages, the pure functions of the plots and point views | Vitest, in node | `src/**/*.test.ts` | derivations, decoding against bytes written by the Rust tests, projections, bins |
| the windows | Playwright, in WebKit and Chromium | `e2e/` | what the user does and sees, in one window and across several |
| the real app | WebdriverIO with the embedded WebDriver plugin | `e2e-app/` | what the harness cannot reach: real IPC, real windows, quitting |

Most tests are in the first and third rows. A test there runs in
milliseconds and says exactly what broke; a test in a window takes
seconds, and when it fails says only that something on the path broke.

## The core and the commands

- The tests of the core build a small table in the test, apply commands,
  and compare with literals worked out by hand: the codes of a column
  after a lasso, the revision after three commands, the snapshot after an
  undo.
- The tests of the commands use `tauri::test`, Tauri's mock runtime,
  which the `test` feature of the `tauri` crate turns on for the tests
  only: `mock_builder()`, the real context, `tauri::generate_context!(test
  = true)`, so that every call is checked against the real capabilities
  (with `mock_context(noop_assets())` there are none, and a window outside
  the capability would pass), a window made
  with `WebviewWindowBuilder`, and `get_ipc_response` to call a command as
  a window would. The mock runtime has no web view, so these tests check
  the wiring, not what a window draws. They call every command once,
  which is what catches a command whose `State` type was never managed, a
  panic at run time (`tauri.md`). They cannot see a window closed: the
  mock runtime never sends the event that removes a destroyed window
  from Tauri's list, so `get_webview_window` still finds it, and the
  closing is left to the tests of the real app.
- A message layout is tested on both sides with the same literal bytes:
  Rust encodes and compares with the literal, TypeScript decodes the
  literal and compares with the values.

## Vitest

- `npm test` runs `vitest run`, once. A session never runs `npx vitest`
  alone: in a terminal it waits for changes and does not end.
- A test file is beside the file it tests and ends in `.test.ts`.
  `vite.config.ts` excludes `spikes/` from Vitest, whose own tests run
  under WebdriverIO.
- `describe`, `test` and `expect` are imported from `vitest` in each
  file; `globals` stays off.
- The name of a test says the behaviour and the outcome:
  `test("a message that skips a revision is a defect")`.
- A float our code computes is compared with `toBeCloseTo` or a tolerance
  with its reason, never with `toBe`.

## The windows, in WebKit and Chromium

`e2e/harness.mjs` runs the real frontend in Playwright, with only Tauri's
IPC replaced. WebKit stands for macOS and Linux, Chromium for WebView2 on
Windows; both run, since a page can work in one and not the other:
`launch({ engine })` opens one, and a test loops over `ENGINES`. The
harness takes its port, 1430, from `E2E_PORT` when that is set, so that
reviewers in parallel worktrees do not collide.

The harness opens one page, in one of two modes:

- **Fixed replies**: each command answers with a value the test gives, and
  a command the test did not mention fails loudly (`e2e/smoke.mjs`).
- **The real core behind it**, `launch({ engine, backend: true })`: the
  harness builds and starts the test-only program of
  `crates/vavilov-e2e-backend`, forwards every call of the page to it as a
  line of JSON, and passes each channel message back to the channel's
  callback with Tauri's `{ index, message }` shape. The program reads each
  call with the app's own `calls::call`, which refuses an argument the
  command does not have, so a name that drifts between the TypeScript and
  the app fails there (`e2e/connection.mjs`). A test loads a table with
  the program's own `e2e:load`, or imports a file it wrote: `e2e:pick`
  gives the file the next dialog of an import or an export gives, or a
  dialog the user closed, and `e2e:action` hands an item of the menu to
  the main window, as a click in the app's menu (`e2e/transfer.mjs`). A
  test waits for the window to take a pick, `e2e:picking`, before it
  picks the next. `e2e:region` sets the decimal mark of the system's
  region, which `launch` sets to its `region`, "." unless given, before
  the page loads, so that a test does not depend on the machine's
  region. A page imports
  the modules it tests from the dev server, `await
  import("/src/backend/connection.ts")`, until a window uses them.

The design extends it (`docs/design.md`, section 11), and the extension
is built with the first code that needs it:

- **One page per window**, in one browser, each with its window's label.
- **Opening and closing windows** goes through the core's interface for
  windows, which the test program implements by asking the harness to
  open and close pages.
- Tauri's own `mockIPC` is not used: it replaces the backend rather than
  the transport, and its event mocking cannot send to one window.

How a test is written:

- **An element is found as a user finds it**, by its role and its name,
  `page.getByRole("button", { name: "Import table…" })`, never by a CSS
  class: a control a screen reader cannot name cannot be found by the
  test either.
- **No fixed waits.** A test waits for the state it expects, with
  Playwright's assertions that retry, or by polling: the cameras of the
  point views keep moving after a drag while damping lasts, so a test
  polls their pose until it stops (`docs/prototype-lessons.md`,
  "Testing").
- **Each test starts from a known state** and depends on no other test.
  A test that must share a running app with others asserts a change from
  a value it set itself: the spike's test of picking passed on broken
  code, because the test before it had left the hover where "not empty"
  was already true (`spikes/windowing/README.md`).
- **A test is shown to fail.** For a bug, the test is run on the code
  with the bug and seen to fail on its assertion before the fix.

### Checking the projection against the pixels

A point view is tested against what the GPU drew, as the prototype did
(`docs/prototype-lessons.md`, "Testing"): for the most isolated points,
the centre of the pixels drawn in the point's colour is within 1 px of
the projected position, since the GPU snaps point sprites by up to half a
pixel, and hovering there names that individual. The pitfalls, each met
once:

- sample the pixel that contains a position with `floor`, not `round`;
- measure a point's isolation against every visible point, not only the
  candidates away from the edges;
- in Playwright's WebKit on the Mac the GPU draws; in its Chromium,
  SwiftShader draws on the processor (popnei_web's `testing.md`), so a
  test of pixels runs in both and a difference between them is looked at,
  not averaged away.

## The real app

A few smoke tests drive the real app through WebDriver, as the windowing
spike did on macOS (`spikes/windowing/`): WebdriverIO's Tauri service with
`tauri-plugin-wdio-webdriver`, in a debug build made with
`--features wdio`. `getWindowHandles` gives the windows by their labels,
and `switchToWindow` reaches each. On Windows and Linux, `tauri-driver`
is the other way. They cover what the harness cannot: the real IPC, the
real windows, throttling, quitting with unsaved changes.

- WebDriver stops a script after 30 s; a longer one sets
  `browser.setTimeout({ script: … })` first.
- They are slow and drive real windows on the screen, so they are run
  when the windows, the IPC or the quitting change, not for every change.

## Seeing the windows

The owner cannot tell from the code whether a window is right, and
neither can a reviewer, so looking at it is part of the work.

- For a change to a window, an e2e test or a scratch script takes the
  window through the states the change touched and writes a PNG of each
  to `e2e/output/`, which git ignores, in the light and the dark
  appearance (`page.emulateMedia({ colorScheme: "dark" })`). The session
  looks at them itself, then gives the owner their paths with what each
  should show.
- For a change the owner wants to try, the session launches the app with
  `npm run tauri dev` in the background and says what to try. The owner
  may be at the Mac, and windows will open on their screen.
- To try the windows with a table at once, the app is launched with the demo table,
  `npm run tauri dev -- --features demo`: 2,000 plants generated by a
  fixed formula in `src-tauri/src/demo.rs`, with four categories, one of
  them of countries, coordinates, three principal components and a
  column of each storage type, some values of every column but the
  components missing. The feature is off by default, so a
  release build has none of it.
- Comparing screenshots pixel by pixel with approved ones is not adopted:
  the windows will change on purpose for a long time, and the pictures
  differ between platforms.

## Before the work is called done

1. The test came first and failed on its assertion before the change.
2. The checks of `SKILL.md` pass, with their output reported.
3. A change to a window was seen, and the owner was given the pictures or
   the running app.
4. A test that passed only on a retry is reported as flaky: a defect to
   find, not a pass. A browser that is not installed, or a layer that does
   not exist yet, is reported as not run.
