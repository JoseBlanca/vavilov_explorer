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
npm run tauri build    # a packaged app in src-tauri/target/release/bundle/
```

## Test

```sh
npm test                    # unit tests (Vitest)
npm run test:e2e            # the frontend in headless WebKit (Playwright)
cd src-tauri && cargo test  # the Rust backend
```

The end-to-end tests drive the real frontend in WebKit, the engine Tauri
uses on macOS, and mock only Tauri's IPC (`e2e/harness.mjs`).

## Background

`docs/prototype-lessons.md` collects what an earlier prototype taught
about the design: what to keep, and the pitfalls already found.

## Licence

MIT; see `LICENSE`.
