# Windowing spike

2 October 2026. A throwaway experiment for the questions at the end of
section 12 of `docs/design.md`, run on macOS only so far. It is not part of
the app: nothing here is built, tested or linted by the app's checks, and
no code here is meant to be reused.

The app here has three windows: a control window, `main`, and two views,
`view-1` and `view-2`, each drawing the same 50,000 points with Three.js.
The Rust backend holds the only copy of the shared state: the hover (one
individual), the selection (one bit per individual) and the populations
(one 16-bit code per individual). A window changes the state with a
command, and the backend sends the change to every window over that
window's Tauri channel as raw bytes. Every window, the sender included,
draws only what comes back. `view-1` accepts the first click of an
inactive window (`acceptFirstMouse`), and `view-2` does not.

## Running it

```sh
npm install
npm run tauri dev                       # by hand, with the control window
npm run tauri build                     # the release binary, for the timings
SPIKE_AUTORUN=1 ./src-tauri/target/release/windowing-spike   # runs the benchmark and exits
npm run tauri build -- --debug --features wdio && npx wdio run wdio.conf.mjs   # the WebDriver check
```

Results are appended as JSON lines to `results.jsonl`, or to the path in
`SPIKE_RESULTS`.

Since 2 October 2026 the spike runs with Tauri's isolation pattern and the
content security policy of the app; the first results below were measured
without either, the section on isolation with both.

The benchmark: `view-1` makes one change per animation frame, 600 hovers,
then 120 selections, then 60 changes of every individual's population.
Each change carries the time `view-1` made it. Both views record when the
change reached their channel callback, "received", and when the frame that
draws it finished rendering, "drawn". `view-1`'s numbers are of its own
changes coming back from the backend.

## Results on macOS

Measured on 2 October 2026 on an Apple M5 Pro (Mac17,9, 64 GB), macOS
27.0.1, Tauri 2.12.1, with the windows on a 2560 x 1440 display at a
device pixel ratio of 1. The clock the windows share,
`performance.timeOrigin + performance.now()`, has a resolution of 1 ms in
WKWebView, so every time below is to the nearest millisecond. Three runs
of the release build; each cell gives the median, the 95th percentile and
the maximum, in ms, with a range where the three runs differed and the
largest maximum of the three.

| change | size of the message | received, view-2 | drawn, view-2 | received, view-1 (echo) |
|---|---|---|---|---|
| hover | 32 bytes | 1 / 2 / 4 | 16–17 / 17 / 19 | 2 / 2 / 4 |
| selection | 6,274 bytes | 2–3 / 4–8 / 13 | 17 / 18 / 20 | 2–3 / 3–4 / 13 |
| populations | 100,024 bytes | 2–3 / 3–4 / 9 | 17 / 18 / 20 | 2–3 / 3 / 4 |

- A change reaches another window in 1 to 3 ms (median), and in at most
  13 ms. That leaves most of a 16.7 ms frame at 60 Hz, so a change is
  drawn on the next frame of the other window.
- "Drawn" is 17 ms, one frame, because the sender makes its change at the
  start of a frame and the receiver draws it at the start of its next
  one. A change made and drawn within one window would also wait for that
  next frame, so the window boundary adds the 1 to 3 ms of "received" and
  no frame. Whether the bar of design section 12, "within one frame of a
  60 Hz screen", is met depends on that reading: the change is on screen
  one frame after it was made, the same as in a single window.
- Messages under 1,024 bytes, the hover, are delivered by Tauri by
  evaluating JavaScript in the window; larger ones, the selection and the
  populations, by the window fetching them over a second IPC request
  (`tauri-2.12.1/src/ipc/channel.rs`). Both paths took 1 to 3 ms.
- Every channel message arrived as an `ArrayBuffer`, and every window saw
  every revision in order, with no gap, across 780 changes in each of four
  runs (one debug, three release).
- Fetching the 600 kB of positions, 50,000 x 3 floats, as a raw command
  response took 2 to 3 ms in the release build and 9 to 14 ms in the
  debug build.
- In the debug build, "received" was about 1 ms higher at the median than
  in the release build, and the hover's maximum was 14 to 15 ms.

### With Tauri's isolation pattern

Run on 2 October 2026 on the same Mac, after the owner decided to use the
isolation pattern (`docs/design.md`, section 12): three release runs with
`app.security.pattern` set to isolation, its isolation application in
`isolation/` passing every message on unchanged, and the cargo feature
`isolation` of `tauri`, which the isolation code needs although Tauri's
guide says no feature is required. Received, median / 95th percentile /
maximum in ms, `view-2`:

| change | without isolation | with isolation |
|---|---|---|
| hover, 32 bytes | 1 / 2 / 4 | 2 / 3–6 / 8–21 |
| selection, 6,274 bytes | 2–3 / 4–8 / 13 | 4–5 / 4–7 / 5–8 |
| populations, 100,024 bytes | 2–3 / 3–4 / 9 | 26–30 / 28–33 / 29–37 |
| the 600 kB of positions, a command's raw response | 2–3 | 58–65 |

- Every message still arrived as an `ArrayBuffer`, in order, with no gap.
- The hover and the selection are about as fast as before. A large
  payload is 10 to 25 times slower: the populations of every individual
  are drawn two frames after the change, not one, and fetching 600 kB
  takes about 60 ms. That a payload's size is what costs was seen, not
  analysed; Tauri encrypts what passes through the isolation application.
- A further run with the content security policy proposed in
  `.claude/skills/coding/tauri.md` as well gave the same numbers and no
  error.

### WebDriver

`tauri-plugin-wdio-webdriver` 1.4.0 with `@wdio/tauri-service` 1.4.0
drove the debug build: `getWindowHandles` returned the three windows, by
their labels (`main`, `view-1`, `view-2`), `switchToWindow` reached each,
a hover set by a command in `view-1` was read in the page of `view-2`, a
pointer movement dispatched in `view-2` was picked and shown in `view-1`,
and a window minimized and restored by command was checked as above.
`test/multiwindow.spec.mjs` holds the four tests.
The plugin is compiled only with the cargo feature `wdio`. The service
warns at the end that it could not clear its mock store; that store
belongs to its other plugin, `tauri-plugin-wdio`, which is not installed.

### By hand

Run by the owner on 2 October 2026, on the same Mac, with the log of the
windows checked afterwards:

- **Hover in an inactive window does not reach the page.** With the
  control window active, moving the pointer over `view-1` or `view-2`
  highlighted nothing, and neither page logged a single `pointermove`
  while its window was inactive. Hovering works in the active window, and
  the hover then shows in the others. WebKit sends mouse movement only to
  the active window; Safari shows no hover effects in a background window
  either.
- **`acceptFirstMouse` behaves as Tauri documents.** In `view-1` (on), the
  first press in the inactive window reached the page 2 ms before the
  window became active. In `view-2` (off), the window became active and no
  press reached the page.
- **A minimized window stays up to date.** Done by a WebDriver test
  rather than by hand, since minimizing a window by hand moves the
  pointer off the points: `view-2` was minimized for 90 s while `view-1`
  sent a hover every 100 ms. With background throttling disabled,
  `view-2` received all 900 messages while hidden, and once restored it
  showed the last revision, 902, and the last hover. The unloading of a
  hidden web view after about five minutes, which Tauri's documentation
  describes when throttling is on, was not tried.

An earlier version of the views projected the points for picking before
the camera's view matrix was computed, so nothing was ever picked; a
WebDriver test, "picks the point under the pointer", now fails on that
version and passes on the fixed one. Its first version passed on the
broken code too: the test before it leaves the hover at 4242, so its
check that the hover was "not -1" was already true before the pointer
moved. It now waits for a hover that is neither -1 nor 4242.

## The manual checks

These need a person at the Mac; each window logs what it receives to the
results file. Start with `npm run tauri dev`, then:

1. Click the control window. Move the pointer over `view-2` without
   clicking. If points highlight in both views, an inactive window
   receives the pointer's movement; the log says "pointermove while the
   window is not active".
2. Click the control window. Press and drag in `view-1`. Then click the
   control window again and do the same in `view-2`. The log records each
   `pointerdown` the page received and whether the window was active;
   `view-2` should log no `pointerdown` for the first press.

Not yet run: Windows and Linux.
