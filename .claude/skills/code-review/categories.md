# The categories of a code review

A reviewer reads the section of its category and the files of
`.claude/skills/coding/` it names. The rules are there with their reasons
and are not repeated here. What is here is what to look for, the evidence
a finding needs, and what is not a finding.

For every category, a finding has a place, a file and a line or a
screenshot and a state; what is wrong; and evidence someone else can
repeat: a command and its output, a sequence of actions in a window and
what happened, a line of `docs/design.md`. What could not be shown is
reported as a suspicion, with what would settle it. Style that `cargo
fmt`, clippy, Prettier and ESLint settle is never a finding.

## intent

Does the code do what was agreed? There is no spec: what was agreed is
`docs/design.md` and what the prompt says the owner decided.

- Go through each decision the change rests on. Find the code that makes
  it true and the test that would fail if it stopped being true. A
  decision with no code, or with code and no test, is a finding.
- Run the cases: the ordinary one, and two or three at the edges: an
  empty table, one row, a column of missing values, a group of one,
  a window opened in the middle of an edit, a window reloaded.
- Look for what the code does that nothing agreed: a default, a clamp, a
  skipped row, an early return, a choice the owner would see. Each is a
  question for the owner or a defect, and the finding says which.

Evidence: the decision and the line that contradicts it, or the case and
what it gave. Not a finding: a choice the owner did not need to make,
made reasonably.

## tests

`coding/testing.md` and the test rules of `rust.md`.

- For every test of the change, break the code it guards and run it: flip
  a comparison, drop a term, return early, skip a broadcast. A test that
  still passes guards nothing. Before reporting one, show that the change
  you made did alter the behaviour.
- The expected values are literals. A test that computes its expectation
  with the code under test is a finding.
- A test that depends on what an earlier test left (the spike's test of
  picking passed on broken code that way), that waits a fixed time, that
  finds an element by a CSS class where a role and a name exist, or that
  runs in one engine where the harness has two.
- Fixtures that hide a defect: all columns of one type, nothing missing,
  all groups of one size, a change that happens not to change the
  result.
- Every number a comment, a test or a commit message gives about the
  change is computed again, not read again.
- Restore the code after each experiment and end with `git status` clean.

## errors

`rust.md`, "Errors, and no panics", and `typescript.md`, "Errors".

- Every path to a panic in the backend: `unwrap`, `expect`, `[]`, a
  division by zero, a lock, an `#[expect]` whose reason does not hold, a
  `State` of a type that is not managed. With `panic = "abort"` each one
  ends the app with the user's unsaved work.
- An error dropped, turned into a default, an empty table or a zero; a
  row skipped without a word; a `let _ =` with no reason.
- A promise left floating in a window, a `catch` that swallows, a defect
  caught and passed over.
- For each way the input can be wrong, a file, a command from a stale
  window, a project of another version, what does the user see? Does the
  message say what happened and how to put it right, with the names from
  the user's file?

Evidence: the input, the action, and the output, the message or the
crash. Not a finding: an error that cannot happen, when you have shown
why it cannot.

## state

`docs/design.md`, sections 3 and 4, and `tauri.md`.

- One source of truth: a piece of shared state kept anywhere but the
  backend's session; a window, a controller or a plot keeping its own copy
  of a part of the window's state.
- A change made other than as a command; a window that changes its own
  display before the change comes back; a command that does not increase
  the revision or does not broadcast.
- The subscribe: snapshot and registration under one lock. A message
  that can fall between them. A window that does not recover from a
  reload.
- A window's copy: a message older than the copy applied; a gap in the
  revisions not reported; an aspect that changed and a component that
  was not told, or was told and did not redraw.
- Undo: a command on the document without its reverse; an undo that does
  not give back the earlier state.

Evidence: a sequence of commands, or of windows opened and reloaded, and
the two states that disagree. Not a finding: a copy a window derives and
throws away on every change.

## numbers

`rust.md`, "Integers" and "Floats", and `typescript.md` on indices.

- Every `#[expect(clippy::arithmetic_side_effects)]` and every comment
  that gives a bound: is the bound true for every caller?
- `as` between integers; a float to an integer without the check for NaN
  and range; a value from a file or a window reaching an index or an
  allocation unchecked.
- Float arithmetic read as arithmetic: a division by a count that can be
  zero, a bin edge that a value equal to it falls on either side of, a
  comparison with `==`, a tie decided by the last bit.
- NaN used for missing inside the core; `array[i]!` or `?? 0` in
  TypeScript.

## api

`rust.md`, "Types, names and defaults", `typescript.md`, "The rules of
the code" and "Names", and doc comments as the `writing` skill asks.

- Names that do not say what the value is, or that differ from
  `docs/design.md` or between Rust and TypeScript.
- Types: `any`, an `as` or a `!` that hides a case, a string where a
  union belongs, a state that is not a discriminated union, a `match` or a
  `switch` that does not name every case.
- Defaults hidden in a constructor or a view, not a named constant with
  its source.
- A function longer than a screen, the same logic in three places, dead
  code, a `TODO` with no issue. A view that holds state or calls the
  backend; a controller and a view in one file.

## frontend

`frontend.md` and `css.md`.

- A view that is not pure; a list drawn without `repeat` and a key, or
  keyed by index; a field that a render overwrites while the user types.
- A `destroy` that leaves a listener, an observer, a subscription, a
  WebGL context, a geometry or a texture behind. Open and close the
  window or the component ten times and count.
- A point view that draws in a loop when nothing changed, projects with
  stale camera matrices, or sends more than one hover per frame.
- D3 and lit-html changing the same element; a scale kept between draws;
  a plot that sets the size it observes.
- A style: a colour or a length written outside `tokens.css`, an element
  selector in a module, `!important`.

Evidence: the line and the sequence that shows the bug, or the count that
grows. Not a finding: an optimisation where nothing was measured to be
slow.

## security

`tauri.md`, "The recommendations of Tauri's guides" and "Configuration",
and `typescript.md` on text from the user's files.

- A capability that grants more than the windows use, or covers windows
  it should not.
- The isolation pattern turned off, or a hook that passes on what it was
  meant to check; the content security policy off or widened; a script, style or font
  from another origin; a network request of any kind (log the requests
  of the harness).
- Text from the user's files reaching `innerHTML`, `unsafeHTML`, or a
  plain object as a key.
- A command argument used before it is checked: a row index, a length, a
  path. A file written somewhere the user did not choose.
- Debug code in a release build: the `wdio` feature, a test backend, a
  log of the user's data.

## accessibility

WCAG 2.2 at level AA, with `css.md` and `frontend.md`, "Native elements
first".

- The keyboard: walk every control of the window with Tab, Shift+Tab,
  Enter, Space, the arrows and Escape, reading `document.activeElement` at
  each step. Every control is reached, in an order that follows the
  window, its focus is visible, and nothing traps it. A dialog takes the
  focus and gives it back.
- Names and roles: every control has a name that says what it does; the
  table has its headers; a selected row says so in `aria-selected`.
- Contrast, computed from the tokens, in both appearances; colour as the
  only sign of a group, a state or an error.
- The point views and plots: a way for the keyboard to do what a drag
  does, where one is needed; their data reachable in the main window's
  table.

Evidence: the keys pressed and the element that had the focus, the two
colours and the ratio, the screenshot. Not a finding: a criterion of
level AAA.

## platform

`typescript.md`, "The engines", `css.md`'s table, `tauri.md`,
"Platforms", and `docs/design.md`, section 10.

- A JavaScript API or a CSS feature above the floor of Safari 17, by
  MDN's compatibility table.
- The harness tests of the change pass in WebKit and in Chromium.
- What differs between macOS, Windows and Linux: hover in an inactive
  window, the first click, throttling and reloads of a hidden window,
  window positions under Wayland, the menu, a file opened from the file
  manager, paths and line endings.

Evidence: the feature and its version, the failing engine, or the
platform and what it does differently. Not a finding: a feature every
engine of the floor has.

## ux

Only when the owner asks. The screenshots of every state and the running
app, against what the owner decided.

- Every state the change has is reachable and looks as agreed: empty,
  working, done, failed.
- The words are those of `docs/design.md` and the `writing` skill's "The
  text of the app"; the same thing named the same in every window.
- Numbers formatted for a reader; a missing value shown as missing; a
  count of what a view leaves out.
- Both appearances, light and dark: nothing cut, overlapping or
  unreadable.

Evidence: the screenshot and its state. Not a finding: a matter of taste
the owner has not decided; a question to the owner instead.
