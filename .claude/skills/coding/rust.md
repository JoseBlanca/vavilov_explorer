# Rust

The rules of the Rust code, in the core crate `crates/vavilov-core` and
in the app crate `src-tauri`. They are popnei's
(`/Users/jose/devel/popnei/.claude/skills/coding/SKILL.md`), with the
reasons of this app. `tauri.md`, beside this file, has what is particular
to the commands, the channels and the windows.

## Why the rules are strict here

The release build is compiled with `panic = "abort"` (`src-tauri/Cargo.toml`):
a panic anywhere in the backend ends the app at once, with every window
and every unsaved edit of the user's populations. And an integer that
wraps in silence, a length read from a file, an index computed from a
selection, gives a wrong window, which nobody notices. So the backend does
not panic and does no arithmetic that can be silently wrong.

## Integers

In a release build `+`, `-`, `*` and `<<` on integers wrap when they
overflow; in a debug build they panic; `/` and `%` by zero panic in both;
`as` between integer types truncates in both.

- Integer arithmetic uses the methods that say what happens on overflow:
  `checked_add` and its family, with the `None` turned into an error, as
  the default; `saturating_` and `wrapping_` only when that is the meaning
  wanted. The lint `arithmetic_side_effects` is denied, so a plain
  operator on integers does not compile.
- Where a bound makes overflow impossible, the plain operator is allowed
  with the bound written down: `#[expect(clippy::arithmetic_side_effects,
  reason = "at most num_rows codes, and num_rows was checked to fit in
  u32 on import")]`. clippy follows the range of some expressions and does
  not fire on them; an `#[expect]` there is itself an error, so the bound
  goes in a plain comment.
- Anything that comes from a file or from a window, a length, an index, a
  column id, a row number, is checked before it is used to index or to
  allocate. A window is our own code, but a stale window can send an
  index of a row that an undo removed.
- To widen, `u64::from(x)`. To narrow, `u32::try_from(x)?`. No `as`
  between integer types. From a float to an integer, check for NaN and
  for the range first: `f64::NAN as usize` is 0.
- A row index is a `u32` in everything that crosses to a window, since
  the selection, the codes and the hover are sent as arrays of fixed
  width; a table of more than `MAX_ROWS` rows, 2^28, is refused when it
  is built, so that every message about it fits the lengths of the
  layout (`docs/core.md`, section 2), a limit no table of individuals
  reaches. Inside the core it may be a `usize` for indexing.

## Floats

- The values of a column are `f64`. `f32` appears only in what is sent to
  a window to be drawn, the positions of the points, where the GPU takes
  `f32`; the conversion is made in one function, at the edge.
- A missing value is never NaN inside the core: a column keeps its
  values and, apart, which rows are missing (`docs/design.md`, section 5).
  NaN that travels through arithmetic hides where it was born, and a NaN
  in a file the user imported is a value of its own, not a missing one.
- Floats are compared with a tolerance that has a reason, and ordered
  with `total_cmp`. A comparison that decides something, which bin a value
  falls in, the order of two levels, breaks its ties by a written rule.
- `exp`, `ln`, `powf` and the trigonometric functions are not rounded the
  same on every platform, so a test never asserts the bits of a value that
  went through them (the Web Mercator projection does).

## Errors, and no panics

`unwrap`, `expect`, `panic!`, `todo!`, `unimplemented!` and indexing with
`[]` are denied outside the tests. Slices are walked with iterators,
`zip`, `chunks_exact`, `get`.

- `Result` everywhere, fail fast. A malformed line of an imported file is
  an error with the line and the field, never a warning and a skipped row.
- An error never passes silently, and is not papered over with a default
  value (`CLAUDE.md`). A `Result` is never dropped; `let _ =` on one needs
  a reason in a comment. An error turned into an empty table, a zero or a
  missing value is the defect this rule is for.
- Each crate has one error enum, `#[non_exhaustive]`, written with
  `thiserror` (approved by the owner on 2 October 2026, `SKILL.md`,
  "Dependencies"), to which each module adds its cases. A case names what was being done,
  `ImportRaggedRow`, `ProjectVersionTooNew`, and carries what finds the
  cause: the path, the line, the column, the value. No error type of a
  dependency is in a public case, so that a user of the core does not
  depend on its versions; `std::io::Error` is of the standard library and
  may be.
- How an error crosses to a window is in `tauri.md`, "Errors across the
  boundary": as a value with its kind and its data, which the window turns
  into words.
- A defect of our own, a state the code makes impossible, is still an
  error and not a panic: a case `Defect { what: String }` that the window
  reports as a defect of the app (`typescript.md`, "Errors").
- A lock is taken with `lock()` and a poisoned lock is an error, not an
  `unwrap`.

## Types, names and defaults

- A name says what the value is: `num_rows`, `active_classification`,
  `revision`, never `n`, `data`, `tmp`, `val`. The things of the app have
  the names of `docs/design.md`, section 1: a classification, a
  population, the selection, the hover, a project, an import.
- The same thing has the same name in Rust and in TypeScript, in
  `snake_case` and `camelCase`.
- Two values of the same primitive that meet in one signature, a row and
  a column, a revision and a count, get newtypes: `RowIndex(u32)`,
  `ColumnId(u32)`, `Revision(u64)`. No `bool` parameters: an enum with two
  named variants. No value of a finite set passed as a string.
- A default that changes what the user gets, the threshold of 20 distinct
  values for a categorical column, the list of missing-value tokens, is a
  named `pub const` with a doc comment that says where it comes from
  ("20, decided by the owner on 2 October 2026"). No `Default` derived on
  a struct whose fields change results, and no `Option` parameter that
  quietly becomes a value.
- A `match` on an enum of ours names every variant, so that a new one
  does not fall into a `_` arm.
- Private by default, `pub(crate)` between modules, `pub` for what another
  crate calls. Every `pub` item has a doc comment, as the `writing` skill
  describes it, with `# Errors` when it returns a `Result`.
- No `unsafe` in the core crate, `#![forbid(unsafe_code)]`. In the app
  crate an `unsafe` block, which only native code for one platform would
  need, carries a `// SAFETY:` comment that names each condition and why
  it holds.
- A lint is silenced with `#[expect(lint, reason = "...")]` on the
  smallest item, never with a bare `#[allow]`.

## What the design asks of the code

- **The session is the one owner of the shared state**
  (`docs/design.md`, section 3). Nothing else in the backend keeps a copy
  of the table, the populations or the selection; the Tauri layer holds
  the session behind one lock and calls the dispatcher.
- **A command is applied whole or not at all.** The dispatcher checks
  everything a command needs before it changes anything, and a command
  that fails leaves the session as it was. The message a window shows for
  a defect says that the user's data has not been changed
  (`docs/design.md`, section 12), and this rule is what makes it true; a
  test of every command's refusals checks the session is unchanged after.
- **Every change is a command** applied by the dispatcher, which checks
  it, applies it, increases the revision and returns what to broadcast.
  A command on the document records the command that reverses it, for
  undo.
- **The revision only grows.** A message to a window carries it, and a
  window ignores what is not newer than what it has.
- **Subscribing is atomic**: the snapshot and the registration of the
  channel happen under the same lock, so that no change falls between
  them.
- **Long work does not hold the lock or the main thread**: an import is
  read and parsed before the lock is taken, and the session is changed in
  one step at the end.
- **Readers and writers take bytes or `impl Read`/`impl Write`**, so that a
  test feeds them from memory; the file system is touched in one module.

## The lint table

It goes into the root `Cargo.toml` of the workspace, and each crate takes
it with `[lints] workspace = true`. It is popnei's, which `table_io` uses
too:

```toml
[workspace.lints.rust]
unsafe_code = "deny"
missing_docs = "deny"

[workspace.lints.rustdoc]
broken_intra_doc_links = "deny"

[workspace.lints.clippy]
# Integers: nothing that wraps or truncates in silence.
arithmetic_side_effects = "deny"
cast_possible_truncation = "deny"
cast_possible_wrap = "deny"
cast_sign_loss = "deny"
cast_lossless = "deny"
fallible_impl_from = "deny"
# No panics outside the tests (clippy.toml exempts the tests).
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "deny"
unimplemented = "deny"
dbg_macro = "deny"
indexing_slicing = "deny"
# Floats, types and the API.
float_cmp = "deny"
wildcard_enum_match_arm = "deny"
fn_params_excessive_bools = "deny"
match_same_arms = "warn"
missing_errors_doc = "warn"
missing_panics_doc = "warn"
# A lint is silenced with a reason, on the smallest item.
allow_attributes_without_reason = "deny"
```

and a `clippy.toml` beside it:

```toml
allow-unwrap-in-tests = true
allow-expect-in-tests = true
allow-panic-in-tests = true
allow-indexing-slicing-in-tests = true
allow-dbg-in-tests = true
```

With `-D warnings`, an `#[expect]` on a line where the lint does not fire
is an error, which keeps the expects honest. Not even the start of the
app panics: `run()` returns Tauri's error, and `main` prints it and exits
with a failure code. Until the core crate is added the table is in
`src-tauri/Cargo.toml` as `[lints.rust]` and `[lints.clippy]`.

## Tests

- The expected values of a test are literals: the values a small table
  written in the test gives, worked out by hand, or the values a file of
  the owner's gives in Excel. A test never computes its expectation with
  the code under test.
- Every field and every parameter takes, in some test, a value that
  differs from the others and from its default: a table whose columns are
  all of one type cannot tell which column the code reads.
- A test has to be able to fail. Check the fixture against the usual ways
  it cannot: a case no fixture reaches, a fixture in which several wrong
  implementations give the same answer, a regime where the thing tested
  does not happen. When in doubt, break the code on purpose and see the
  test fail.
- A reader gets the malformed inputs as cases of their own.
- The name of a test says the behaviour and the outcome:
  `a_lasso_on_an_unassigned_individual_adds_it_to_the_selected_population`.
