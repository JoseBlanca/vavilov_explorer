# Vavilov Explorer

A desktop application to explore populations and biodiversity in an
integrated way: the same individuals shown at once in 3D (for example a
PCA), on a geographic map, and in the distributions of their traits, so
that what is selected in one view is seen in all of them.

Named after Nikolai Vavilov, who brought together expeditions, geography
and genetic diversity to find where crops come from.

Built with [Tauri 2](https://tauri.app): a Rust backend and a TypeScript
frontend in the system webview.

## Run

```sh
npm install
npm run tauri dev      # the app, with hot reload
npm run tauri dev -- --features demo   # the app with the demo table loaded
npm run tauri build    # a packaged app in target/release/bundle/
```

A package is built on the system it is for, so the installers are built
on GitHub (`.github/workflows/release.yml`): pushing a tag such as
`v0.1.0` builds them for macOS, Windows and Linux and puts them in a draft
pre-release of the tag, with the notes of
`docs/release-notes/<version>.md`, to be read and published by hand. Run
by hand from the Actions tab ("Release", "Run workflow"), it builds them
only, as downloads of the run for 30 days. The installers are not signed:
the notes say how to open them.

## Test

```sh
npm test                    # unit tests (Vitest)
npm run test:e2e            # the frontend in headless WebKit (Playwright)
cargo test --workspace      # the Rust backend: the core and the app
```

The end-to-end tests drive the real frontend in WebKit, the engine Tauri
uses on macOS, and mock only Tauri's IPC (`e2e/harness.mjs`).

## Background

`docs/design.md` records the agreed design: windows, shared state, the
table, the project file, platforms and testing, with the decisions still
open. `docs/prototype-lessons.md` collects what an earlier prototype
taught: what to keep, and the pitfalls already found.

## Licence

MIT; see `LICENSE`.
