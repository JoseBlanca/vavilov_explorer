# Tauri: commands, channels, windows

How the backend and the windows talk, and how the windows are made. The
design behind it is in `docs/design.md`, sections 3, 4 and 10, and what
was measured on macOS is in `spikes/windowing/README.md`. Tauri is 2.12.1,
as `Cargo.lock` has it; what is said here of its behaviour was read in its documentation and its
source (`~/.cargo/registry/src/*/tauri-2.12.1/`), and is checked there
again when Tauri is upgraded.

## The two ways in and out

- **A command** is a call from a window to the backend, `invoke` in
  TypeScript and a `#[tauri::command]` function in Rust. It is how a window
  asks for anything: a change, a column, a snapshot.
- **A channel** is a stream of messages from the backend to one window,
  delivered in the order they were sent. Each window gives the backend
  one channel when it subscribes, and every change reaches it there.

Tauri's events are not used. Their payloads are JSON strings, and Tauri's
documentation says the event system "is not designed for low latency or
high throughput".

## The recommendations of Tauri's guides

Tauri's guides on security, the process model, state, commands and
testing (v2.tauri.app, read on 2 October 2026) recommend, and this file
follows:

- **The core process owns the global state**, and the webviews only draw
  and pass on what the user does (the process model). That is the design
  of `docs/design.md`, section 3.
- **Every value that crosses between a window and the backend is checked**
  on the side that receives it ("inspecting and strongly defining all data
  passed between boundaries"): the backend checks every argument of a
  command, a row index, a length, a column id, and the window checks every
  message it decodes.
- **Least privilege**: the capabilities grant each window only the
  permissions it uses (below).
- **A content security policy** (below).
- **Dependencies kept up to date**, Rust and npm, since the app's security
  is that of all of them; an upgrade is a commit of its own (`SKILL.md`).
- **The isolation pattern** is used, as the owner decided on 2 October
  2026 (`docs/design.md`, section 12). Tauri runs every message a window
  sends through a small isolation application in a sandboxed `<iframe>`,
  whose hook may check or refuse it, and encrypts it with AES-GCM before
  it reaches the backend; it guards against a malicious frontend
  dependency. In `tauri.conf.json`, `app.security.pattern` is
  `{ "use": "isolation", "options": { "dir": "../isolation" } }`, and
  `isolation/index.js`, at the root of the repository, sets
  `__TAURI_ISOLATION_HOOK__`, which returns the payload it is given. It is
  a plain script and not an ES module, because on Windows a module does
  not load in the sandboxed frame (Tauri's guide). Both `tauri` and
  `tauri-build` need their cargo feature `isolation`, although the guide
  says no feature is required: without it the isolation code is not
  compiled, and the build script refuses the configuration.
- **What isolation costs**, measured with the windowing spike on the
  owner's Mac on 2 October 2026 (`spikes/windowing/README.md`): the hover
  and a selection of 6 kB take as long as without it, 2 and 4 to 5 ms; a
  payload of 100 kB takes 26 to 30 ms instead of 2 to 3, and a command's
  raw response of 600 kB about 60 ms instead of 2 to 3. Every message still
  arrives as an `ArrayBuffer`, in order. So a large payload is drawn a
  frame or more later than a small one. The owner decided to keep it
  unless it causes problems in real work; a bulk transfer the user waits
  on, a column of a large table, is where to look first.

## Commands

- **Commands are in their own module**, `src-tauri/src/commands.rs`, each
  `pub`, all registered in one `tauri::generate_handler!`. Tauri's macro
  cannot make a command defined in `lib.rs` public.
- **A command is a thin wrapper of the core's dispatcher**: it takes the
  session's lock, calls the dispatcher, sends what it returns to the
  channels, and returns. It holds no rule about the data (`SKILL.md`,
  the layers).
- **Where it runs.** A command without `async` runs on the main thread,
  the thread of the windows' event loop, so it must be short: a change to
  the selection, a hover. A command that reads a file, imports a table,
  writes a project, is `async`, so that the windows keep responding, and
  does its work before it takes the lock.
- **A command that creates a window is `async`.** Creating a window from
  a synchronous command deadlocks on Windows (Tauri's doc comments of
  `WebviewWindowBuilder::build`).
- **Raw bytes need Tauri's custom IPC protocol.** After one failed request
  to it, a window falls back to `postMessage` for the rest of its life
  (`tauri-2.12.1/scripts/ipc-protocol.js`), and on that path a raw body
  arrives as JSON and a raw response or channel message as a JSON array of
  numbers. The commands and the decoder then fail loudly, as defects whose
  message names the fallback; a reload restores the protocol.
- **A window made outside the session's lock may be one the session has
  closed meanwhile**: a load or a change of role that runs while it is
  being built closes a label that has no window yet. So once the window
  exists, the command checks under the lock that its widget is still open,
  and closes the window when it is not (`windows::open_widget_window`,
  found by the review of 3 October 2026).
- **A window is never destroyed from inside its own call**: the close is
  queued with `run_on_main_thread`, as creating one from a synchronous
  command deadlocks on Windows.
- **Bulk data is returned as raw bytes**: a command returns
  `tauri::ipc::Response::new(bytes)`, which the window receives as an
  `ArrayBuffer`, with no JSON. A column of 50,000 `f32` is 200 kB; the
  spike fetched 600 kB in 2 to 3 ms in a release build.
- **Bulk data sent to the backend is a raw body**: the window calls
  `invoke(cmd, bytes, { headers })` with a `Uint8Array`, and the command
  reads `InvokeBody::Raw` from its `tauri::ipc::Request`, checking the
  length before anything else.
- **Small arguments are JSON**, named in camelCase in TypeScript and
  snake_case in Rust; Tauri converts the names.

## The state in the backend

- The session is managed once, `app.manage(Mutex::new(session))`, with
  the standard library's `Mutex`, which Tauri's guide prefers even in
  async code; the guard is never held across an `.await`. No `Arc`: Tauri
  wraps managed state in one.
- **One type alias names it**, `type SessionState<'a> = State<'a,
  Mutex<Session>>;`, and every command takes that alias. A command that
  asks for a `State` of a type that was never managed panics at run time,
  not at compile time (Tauri's guide), and the release build turns a
  panic into the end of the app. The test of the commands calls every
  command once (`testing.md`), which is what catches a wrong type.
- An async command cannot take `State<'_, …>` with a borrowed lifetime
  unless it returns a `Result`; every command of ours returns one anyway.

## Channels and messages

- The channel is a `Channel<InvokeResponseBody>`, and each message is
  `InvokeResponseBody::Raw(bytes)`, which arrives in JavaScript as an
  `ArrayBuffer`. A `Channel<Vec<u8>>` would not: `Vec<u8>` is
  `Serialize`, and is sent as a JSON array of numbers (Tauri's doc comment
  of `Channel`).
- Tauri delivers a message under 1,024 bytes by evaluating JavaScript in
  the window, and a larger one by the window fetching it over a second
  request (`tauri-2.12.1/src/ipc/channel.rs`). Both took 1 to 3 ms in the
  spike; the order is kept either way, by an index Tauri adds.
- **Every message has a fixed header**: its kind, the revision, and the
  time the sending window gave with the command, which the core copies
  and never reads a clock for, little-endian, then the payload. The time
  is what the windowing spike measured latency with, and is kept so that
  it can be measured again. The layout is
  written once in Rust and once in `src/backend/`, each with a test that
  decodes bytes the other side wrote as a literal. The spike's header,
  24 bytes, is the starting point (`spikes/windowing/src-tauri/src/lib.rs`).
- **Subscribing** returns a snapshot at revision r and registers the
  channel in the same lock, so that the channel then carries every change
  after r. A window that is reloaded, or that WebKit unloaded while it was
  hidden, subscribes again and replaces its channel; the backend keeps one
  channel per window label.
- **A channel that fails to send is dropped and reported**, as a closed
  window's would be; never kept, never ignored in silence.
- **The hover is the latest value only**: the window sends at most one per
  frame it draws, and the backend keeps no queue of hovers: the hover is
  a synchronous command, so it runs on the main thread, from where Tauri
  hands a channel's message to the web view within the call
  (`tauri-runtime-wry`, `send_user_message`). A queue per window that
  keeps only the newest hover is added to the app if hovers are seen to
  lag on Windows or Linux (`docs/core.md`, section 5). The hover does not
  take a revision, whose sequence a dropped message would break: it
  carries a sequence number of its own, and a window keeps the highest
  it has seen (`frontend.md`).

## Errors across the boundary

A command returns `Result<T, CommandError>`, where `CommandError` is a
serialisable enum with a `kind` and the data its message needs:

```rust
#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommandError {
    ImportRaggedRow { line: u64, fields: u32, expected: u32, separator: char },
    ProjectVersionTooNew { found: u32, supported: u32 },
    Defect { what: String },
}
```

Tauri's guide serialises an error as its message, a string. Here it is
serialised as an object with its kind and its data instead, because the
words belong to the window (below) and a test asserts the kind and the
data, not a sentence. Tauri rejects the window's promise with that object. `src/backend/`
catches it at the call, checks its shape, and returns a `Result` of
`typescript.md` with the typed error; the window writes the words from the
kind and the data, as the `writing` skill says of the app's text. The
backend never sends text meant for the user: the words are the window's.

## Windows

- **Labels**: `main`, and for widgets the kind and a number,
  `scatter3d-1`, `histogram-2`. A label never contains a user's text.
- **A capability for each kind of window**, each granting the fewest
  permissions that work: the `allow-` of each command of ours its windows
  call, and of Tauri's own functions only those they call, never a whole
  set such as `core:default` when one permission is used.
  `capabilities/default.json` is the main window's, and each kind of
  widget has its own, which covers its windows with a pattern of labels:
  `capabilities/widgets.json`, `"windows": ["scatter3d-*"]`, for the 3D
  scatter, `map.json` for the map of the individuals, which cannot add,
  edit or delete a group, and `countryMap.json` for the map of countries,
  which cannot fetch a column, a row or set the hover either (3 October
  2026).
  One file for all windows, as this rule said before 3 October 2026,
  would let a widget call what only the main window needs, an import
  among them. The windows call none of Tauri's own today: the window's
  label is read without a call, its title is set from its page's
  (below), and a channel's fetch is exempt from the check
  (`tauri-2.12.1/src/webview/mod.rs`). A test of the commands checks that
  each window is refused the commands it does not use.
- **Our commands are listed in `src-tauri/build.rs`**, in the
  `AppManifest` given to `tauri_build::try_build`. Without the list Tauri
  checks the capabilities only for its own and plugins' commands, and any
  window of the app could call ours (`tauri-2.12.1/src/webview/mod.rs`,
  the check of the ACL). The build writes an `allow-` and a `deny-`
  permission for each into `src-tauri/permissions/autogenerated/`, which
  is committed; a new command is added to the list and its `allow-`
  permission to the capability of the windows that call it.
- **Widgets are top-level windows with no parent**: on macOS a parent
  attaches the child so that it moves with it, and on Windows it makes the
  child always sit above it (`docs/design.md`, section 2.2).
- **Every window turns off background throttling** where Tauri can
  (`BackgroundThrottlingPolicy::Disabled`, macOS 14 and later), and every
  window recovers from a reload anyway, since Windows and Linux cannot
  turn it off.
- **`accept_first_mouse(true)` on the point views only**, the 3D scatter
  and the map of the individuals; the map of countries, the histograms,
  the bar plots and the main window keep the default, since a click there
  selects (`docs/design.md`, section 10).
- **Widgets cannot go fullscreen**; they can be maximized. On macOS the
  builder's `maximizable(false)` disables the green button, which would
  take the window fullscreen (tao 0.37, `set_maximizable`); Window >
  Maximize of the menu still fills the screen.
- **Windows are created hidden**, given their size and position, and then
  shown, so that a restored layout does not flash in the wrong place.
- **A widget's title is its page's**: the window sets `document.title`,
  in its words, and the app copies it to the window with the builder's
  `on_document_title_changed`, so that no window needs Tauri's permission
  to set a title and the e2e harness reads the title from the page.
- **A widget opens with no position of its own**, at 800 by 640 logical
  pixels, where the system puts a new window, until the layouts of
  `docs/design.md`, section 2.4, restore one.
  Positions are checked against the monitors present, and under Wayland
  they are neither set nor read (tao: "has no effect").
- **The menu** is defined once, in the backend: the app's menu bar on
  macOS, the main window's on Windows and Linux. A keyboard shortcut is
  handled by the window, through one module, and does not depend on the
  menu (`frontend.md`, "Keyboard").
- **Quitting**: closing the main window asks to save unsaved changes, then
  quits; `RunEvent::ExitRequested` is where the question is asked, with
  `prevent_exit` only while it is open. `RunEvent::Reopen`, macOS's click
  on the Dock icon, shows the main window again.

## Configuration

- **The content security policy is on**, in `tauri.conf.json`, set by the
  setup commit: with
  `"csp": null`, as the template has it, there is none. The policy allows
  the app's own files and Tauri's IPC, and nothing else: no script, style
  or font from another origin. Tauri adds its nonces and hashes at build
  time. A starting point, from Tauri's guide:

  ```json
  "csp": {
    "default-src": "'self'",
    "connect-src": "ipc: http://ipc.localhost",
    "img-src": "'self' blob: data:",
    "style-src": "'self' 'unsafe-inline'"
  }
  ```

  `'unsafe-inline'` for styles is there because Three.js and D3 set
  `style` attributes; it is removed if the app turns out not to need it.
- **`withGlobalTauri` is off**, which the template had on (set by the
  setup commit, `SKILL.md`): the frontend imports `@tauri-apps/api`,
  and nothing needs `window.__TAURI__`. The e2e harness mocks
  `window.__TAURI_INTERNALS__`, which the package uses either way.
- **Every file the app loads is in the app**: the Natural Earth borders
  come from the `world-atlas` package, not from a server. The app makes no
  network request.

## Debug-only plugins

The WebDriver plugin of the real-app tests, `tauri-plugin-wdio-webdriver`,
is an optional dependency behind the cargo feature `wdio`, registered
under `#[cfg(feature = "wdio")]`, as the spike does. `cfg(debug_assertions)`
does not work for this: cargo ignores it when it chooses dependencies, so
a release build would still contain the plugin. The release build is
checked to contain none of it.

## Platforms

What differs between macOS, Windows and Linux, and has to be remembered
when a window, an input or a file is involved, is in `docs/design.md`,
section 10. The ones that change code:

- Hover in an inactive window does not reach the page on macOS: a view
  must not depend on hover events while it is inactive.
- A hidden window may be throttled or unloaded on Windows and Linux: a
  view must draw correctly from a fresh subscribe at any moment.
- A `.vav` file opened from the file manager arrives as
  `RunEvent::Opened` on macOS and as an argument of a new process on
  Windows and Linux, which Tauri's single-instance plugin passes to the
  running instance.
