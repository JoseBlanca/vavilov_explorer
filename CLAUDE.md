# Vavilov Explorer

A Tauri 2 desktop app (Rust backend, TypeScript frontend) to explore
populations and biodiversity: the same individuals in linked 3D,
geographic and distribution views. See `README.md` for commands,
`docs/design.md` for the agreed design and `docs/prototype-lessons.md`
for what an earlier prototype taught.

## Working rules

These are the owner's standing rules for AI-assisted work on this project:

- Professional-grade code, no spaghetti. One component per file, with
  controller and view kept apart. One source of truth for every piece of
  state.
- Ask before creating or changing anything in the user-facing UI or UX.
- Choose the most robust option instead of offering many; suggest at most
  two or three next steps.
- Errors never pass silently, and are not papered over with default values.
- Diagnose before fixing. Write a test that triggers a bug before fixing
  it, so that it cannot come back.
- Tests exercise the real code, with minimal mocks, and cover the
  user-facing features.
- Debug code must never crash production.

## Checks

Before calling a change done: `npx tsc --noEmit`, `npm test`,
`npm run test:e2e` and, in `src-tauri/`, `cargo test` and `cargo clippy`.
