---
name: coding
description: How code is written in Vavilov Explorer, the Tauri 2 desktop app with a Rust backend and a TypeScript frontend (lit-html, D3, Three.js). Use it before writing or changing any code or test. It covers how the owner and the assistant work together, the layers and what each may import, the order of the work, dependencies, and the checks to run before the work is called done, and it points to the topic files beside it, rust.md, tauri.md, typescript.md, frontend.md, css.md and testing.md.
---

# Coding

Vavilov Explorer shows one table of individuals in several linked windows
(`docs/design.md`). The backend, in Rust, holds every piece of state that
more than one window needs; each window keeps a copy, draws it, and asks
the backend for every change. What the app is and why it is built this
way is in `docs/design.md`; what an earlier prototype taught, about
rendering, the map and the lasso, is in `docs/prototype-lessons.md`. The
owner's standing rules are in `CLAUDE.md` and come first.

Most of what follows is enforced by the compilers and the linters, whose
settings are in the topic files. A rule a tool enforces is given with its
reason and not repeated in detail. The prose is for what no tool catches.

## How we work

There are no specs and no implementation plans. The owner stays on top of
the development:

1. **The idea is discussed first**, in chat. The owner decides what is
   built, and every change to what the user sees or does, a window, a
   control, a word, a colour, a default, is asked before it is made
   (`CLAUDE.md`). A choice the owner does not need to make, the name of a
   private function, the order of two statements, is made and not asked.
2. **The decision is written where it lasts**: a decision about the app
   goes into `docs/design.md`, in the section it concerns, with its
   reason; a rule about the code goes into this skill.
3. **The code is written** in the order below, as small as the idea asks.
4. **The owner sees it working.** A change to a window is shown to the
   owner, as screenshots or by launching the app, before it is called
   done (`testing.md`, "Seeing the windows").
5. **A commit is made when the owner asks for one**, on `main` until the
   owner says otherwise, with the message the `writing` skill describes.
6. **A review is made when the owner asks for one**, as the `code-review`
   skill says. There is no review after every change, so that the windows
   can be tried and changed freely.

When the code shows that something agreed cannot work as agreed, the work
stops there and the owner is told what was found, with a recommendation.
Working around a decision in silence leaves the owner with an app that is
not the one they think they have.

## What to read

Every session reads this file, and then the topic file of each part it
changes:

| part | topic file |
|---|---|
| any Rust | `rust.md`: integers, floats, errors without panics, types, lints, tests |
| the commands, the channels, the windows, `tauri.conf.json`, the capabilities | `tauri.md` |
| any TypeScript | `typescript.md`: the compiler, the rules of the language, errors |
| a window, a view, a plot, a point view | `frontend.md` |
| a style | `css.md` |
| any test, or running the app | `testing.md` |

## The layers and what each may import

The layout, from `docs/design.md`, sections 3 and 9:

| layer | where | holds | may use | must not use |
|---|---|---|---|---|
| core | `crates/vavilov-core/` | the table, the session, the commands, undo, the project file, the import and export through `table_io` | std, `table_io`, small pure crates the owner took | Tauri, any GUI, the clock or the file system except in the module that reads and writes files |
| app | `src-tauri/` | the Tauri commands, each a thin wrapper of the core's dispatcher; the channels; the windows; the menu | the core, Tauri and its plugins | any rule about the data: an `if` about a column or a population there is in the wrong crate |
| backend client | `src/backend/` | the only TypeScript that calls Tauri: commands, channels, the decoding of binary messages | `@tauri-apps/api`, `src/state` types | the DOM, lit-html, D3, Three.js |
| state | `src/state/` | the window's copy of the backend's state and what is derived from it, pure functions | nothing of ours but other `src/state` files | the DOM, Tauri, lit-html, D3, Three.js |
| plots | `src/plots/` | D3 plots and the Three.js point views, each a function of an element and data that returns a handle | D3, Three.js, `src/state` types | `src/backend`, `src/windows`, lit-html |
| windows | `src/windows/` | for each kind of window, its controller and its views; the shared views in `src/windows/shared/` | everything above, lit-html | `@tauri-apps/api` directly |

The reasons:

- **The core has no Tauri**, so that `cargo test` covers it alone and the
  e2e harness can run the real core without Tauri (`docs/design.md`,
  section 11).
- **One TypeScript module talks to the backend**, so that the e2e harness
  replaces one thing, Tauri's IPC, and a change of the protocol is a
  change in one place.
- **The state has no DOM**, so that its derivations are tested in node,
  as plain functions.
- **A plot knows nothing of the backend or of a window**: it takes an
  element and data and returns a handle (`frontend.md`). Only a window
  joins a plot to the state.

These rules are made into lint rules (`typescript.md`, "ESLint") once the
folders exist, so that a wrong import fails the lint.

## One component per file, controller and view apart

The owner's rule (`CLAUDE.md`) is read this way here:

- **A component** is one piece of a window that the user sees as one
  thing: the populations panel, the table, the column-type dropdown, a
  histogram plot.
- **Its view** is a pure function from the state it shows to a lit-html
  template, in a file of its own, `populationsPanel.view.ts`. It holds no
  state, calls no command and reads nothing but its arguments; the
  callbacks for the user's actions come in as arguments.
- **Its controller**, `populationsPanel.controller.ts`, holds what the
  component keeps of its own (a field being typed, a menu open),
  subscribes to the part of the state it shows, turns the user's actions
  into commands of the backend, and renders the view into its element.
- A plot or a point view has a handle instead of a view (`frontend.md`),
  and its controller is the window's.

## The order of the work

1. **The types first.** The shape of the data the change adds, the
   messages, the unions of states and of errors, the signatures, written
   and type checked before any body, in Rust and in TypeScript. A state
   that the types cannot express cannot happen, and a reader reads the
   types before the code.
2. **The test**, which fails before the change, on its assertion. To make
   it compile, the new function gets a body that returns a wrong value,
   never `todo!()` and never a throw. Run it and see it fail. When a
   change cannot have such a test, a rename, a move, say so in the commit
   message. A bug gets a test that reproduces it before it is fixed
   (`CLAUDE.md`), and the test is shown to fail on the code with the bug.
3. **The code**, as small as the change asks for.
4. **The checks**, below, all of them, with their real output.
5. **Seen working**, for a change the user sees (`testing.md`).

## Dependencies

A library is taken only when it is the established standard of its field,
or too large to write ourselves, because each one is a future upgrade, a
possible break and a possible abandonment.

- **A new dependency is the owner's decision**, runtime or development,
  Rust or npm. Propose it with what it gives, why a few lines of ours do
  not, who maintains it, its size and what it pulls in (`npm view <name>
  dependencies`, `cargo tree`), and wait. The decision is recorded in
  `docs/design.md`.
- **Decided** (`docs/design.md`, sections 7, 9 and 12, and
  `docs/table_io-needs.md`, section 8): lit-html; the D3 modules
  `d3-array`, `d3-scale`, `d3-axis`, `d3-selection`, `d3-brush`;
  Three.js; Vite, Vitest, Playwright, TypeScript, ESLint with
  typescript-eslint, Prettier; Tauri 2. In Rust, `table_io`, by git at a
  pinned revision; `thiserror`, for the error enums, and `serde`, for
  what crosses to a window, approved by the owner on 2 October 2026
  (Tauri depends on `serde` already); `serde_json`, as a development
  dependency of the core only, approved the same day.
- **Named by these skills and not yet decided**, each to be proposed when
  the first code needs it: a
  Parquet crate and a zip crate for the project file (`docs/design.md`,
  section 8); `world-atlas` and `topojson-client` for the map's borders,
  as in the prototype; WebdriverIO's Tauri service and
  `tauri-plugin-wdio-webdriver` for the tests of the real app, as in the
  windowing spike; Tauri's single-instance plugin, for a `.vav` opened
  from the file manager on Windows and Linux.
- **npm versions are exact** in `package.json`, by `save-exact=true` in
  `.npmrc`, and `package-lock.json` and `Cargo.lock` are committed. An
  upgrade is then a change someone made, in a commit of its own, one
  library at a time, with the checks run.
- A dependency used only by a spike stays in the spike's own
  `package.json` or `Cargo.toml`.

## Before the work is called done

```
npm run format:check
npm run lint
npx tsc --noEmit
npm test
npm run test:e2e
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The cargo commands run at the root of the repository, the Cargo
workspace whose members are `src-tauri` and `crates/*`. All of them run for every change to the
code; a change to documents alone needs none. A command or a layer that
does not exist yet is reported as not there, not as passed.
Report what each command printed when it failed and that it passed when
it passed. `--fix` of ESLint and `--write` of Prettier change files, and
their changes are read before they are committed.

## Not set up yet

The skills describe the project as it is meant to be. The setup commit of
2 October 2026 made the tooling: exact npm versions, the compiler options,
ESLint, Prettier, the content security policy, the isolation pattern, the
Rust lint table and the harness in two engines. The first slice of the
core made the core crate `crates/vavilov-core` and the Cargo workspace at
the root, with the lint table. These parts come with the first code that
needs them:

- the folders of `src/` (`backend`, `state`, `plots`, `windows`), whose
  import rules `eslint.config.js` already holds;
- the harness's several pages (`testing.md`); the test-only backend
  exists, for one page.

Until a part exists, a session follows the rule and reports the check as
not there.

## Debug code

Code that exists only for tests or development, the WebDriver plugin, a
test backend, a logging switch, is behind a cargo feature or a build flag
that a release build does not have, and is checked to be absent from the
release build. It never crashes production (`CLAUDE.md`): it does not
panic, and it does nothing unless it was asked for.

## Spikes

A spike is a throwaway experiment that answers a question the design
cannot answer by reading, under `spikes/<topic>/`, with its own
`package.json` and `Cargo.toml`, outside every check of the app and
excluded from Vitest (`vite.config.ts`). It is never imported by the app.
What it leaves is its README, with the numbers and what they were
measured on, and the line in `docs/design.md` that the result settles.

## When this skill is wrong

Written on 2 October 2026, before any code of the app, from the skills of
popnei and popnei_web and the windowing spike. A rule that proves wrong or
too noisy in the code is corrected here, with what showed it.
