# The core of Vavilov Explorer

2 October 2026, before any code of the core, reviewed and with the
owner's answers to its questions. The core is the Rust crate that holds
the table of individuals, the session every window shares, and the
commands that change it. This document outlines how it is built: the
crate and the Cargo workspace, the table, the session and its three
tiers of state, the commands and their undo, how a window subscribes,
the binary messages, how the core opens windows, its errors, and how it
receives a table before `table_io` exists. It ends with what the first
slice of code builds, what the owner decided, and the one point still
open. The design it rests on is `design.md`, sections
1, 3, 4, 5, 6, 8, 11 and 12; the rules of the code are in
`.claude/skills/coding/`, mainly `rust.md` and `tauri.md`; what the core
needs from `table_io` is in `table_io-needs.md`.

The words of the app are those of `design.md`, section 1: the **active
classification** is the categorical column that colours every view, a
**group** is one of its values, the **selected groups** are those the
user chose in the groups panel, none, one or several, and a **lasso** is
the outline the user draws around points in a plot to add them to the
one group selected or to remove them from those selected. A **widget** is one plot, a 3D
scatter, a map, a histogram or a bar plot, in a window of its own or a
tile of a window that holds several; the core knows none of them
(section 7). `table_io` is the owner's
library that reads and writes CSV and xlsx files, being built in its own
repository. The **e2e harness** is the program that runs the windows of
the app in a test browser, with the backend behind them
(`design.md`, section 11).

Some words of Tauri and of the web are used throughout:

- **A window** is a Tauri window, a web view with its own JavaScript.
  Nothing in one window is visible to another; each has a **label**, a
  name fixed when it is created, such as `main` or `scatter3d-1`.
- **A Tauri command** is a call from a window to the Rust side, which
  returns a value or an error. **Invoking** it is making that call.
- **A channel** is a stream of messages from the Rust side to one window,
  delivered in the order they were sent. Each window hands one to the
  backend when it subscribes.
- **An `ArrayBuffer`** is a block of raw bytes in JavaScript. A **typed
  array**, such as a `Uint16Array`, reads it as numbers of one width
  without copying it, but only from an offset that is a multiple of that
  width: a `Float64Array` that starts at byte 12 is refused.

## 1. The crate and the workspace

The core is the library crate `vavilov-core`, in `crates/vavilov-core/`.
It has no Tauri and no GUI. The Tauri app, `src-tauri/`, depends on it
and is a thin layer of commands, channels and windows over it
(`coding/SKILL.md`, "The layers"). The core has no Tauri so that
`cargo test` covers the whole backend logic without a window, and so that
the test program of the e2e harness (section 7) runs the same dispatcher
as the app.

A Cargo workspace at the root of the repository holds both crates:

- `Cargo.toml` at the root has `members = ["src-tauri", "crates/*"]`,
  `resolver = "3"`, and `exclude = ["spikes", "tmp"]`. A workspace with no
  package of its own does not take the resolver from the edition, and
  Cargo warns and uses the old one unless it is written. The windowing
  spike, the throwaway experiment in `spikes/windowing/`, has a
  `Cargo.toml` under the root; Cargo refuses to build a package that sits
  inside a workspace without being one of its members, unless the
  workspace excludes it. `tmp/` is where sessions and reviewers make
  scratch Cargo projects, and is excluded for the same reason.
- The lint table of `rust.md` moves from `src-tauri/Cargo.toml` to
  `[workspace.lints]`, and each crate takes it with `[lints] workspace =
  true`. `edition`, `rust-version` and `license` move to
  `[workspace.package]`.
- `[profile.release]`, with `panic = "abort"`, moves to the root: Cargo
  reads profiles only from the root of a workspace and ignores, with a
  warning, those of a member.
- `clippy.toml` moves to the root, where clippy finds it from each crate
  by looking in the parent directories; `Cargo.lock` moves to the root,
  where Cargo writes it; the build goes to `target/` at the root, which
  `.gitignore` gets.
- The `cargo` checks of `coding/SKILL.md` then run at the root.

The core starts with two dependencies, both approved on 2 October 2026:
`thiserror` and `serde`, with its `derive` feature. Both are in
`Cargo.lock` already, through Tauri, so they add no crate to the build.

The crate is split into one file per piece, each named by what it holds:

| file | holds |
|---|---|
| `ids.rs` | the newtypes of section 2: `ColumnId`, `RowIndex`, `LevelCode`, `Revision`, `HoverSeq`, `WindowLabel` |
| `row_set.rs` | `RowSet`, a set of rows as one bit per row |
| `table/` | the table, its columns, the levels of a categorical column, the colours |
| `session/` | the session, the document with its undo history, the interaction, the subscribers |
| `command.rs`, `dispatch.rs`, `edit.rs` | the commands, the dispatcher, and the edits of the document with their reverses |
| `message/` | the binary layout of the messages |
| `error.rs` | `CommandError` |

## 2. The table

The table has a fixed number of rows, one per individual, and a list of
columns. Rows are never added or removed while a project is open
(`design.md`, section 1, lists the edits, and none adds a row), so a row
index checked once against the number of rows stays valid until another
table is loaded.

- **The first column** names the individuals. It is held apart from the
  others, as a header and one text per row, and has no type: the names
  are text as written, none empty and no two the same, checked when the
  table is built. Holding it apart lets the types say what `design.md`
  section 5 says: it cannot be retyped or removed, and its values are
  never missing.
- **A column id**, `ColumnId(u32)`, is given when a column is created and
  never changes, so that a widget or a message names a column by its id
  and a rename breaks nothing. The first column has one too, 0, and a
  revision like the others; it is not categorical, so a command that
  needs a classification refuses it as such. A table
  keeps the next id to give, which only grows: a column that is added and
  then undone does not give its id back, so a stale window that still
  names it is refused rather than pointed at a newer column. `u32::MAX`
  is never an id, because the messages use it for "no column"; the
  counter is checked against it before an id is given.
- **A name** is unique within the table, compared exactly, and not empty.
  The header of the first column must be `IndividualID`, compared with
  case, spaces and underscores ignored (`design.md`, section 5); the
  table keeps no header of its own for it, and no other column may be
  named `IndividualID`.
- **The storage type and the role** (`design.md`, section 6): the
  storage types are whole numbers, decimal numbers, yes or no, and text,
  and the roles number, latitude and longitude, category and country,
  and text. A column's values are held in the shape of its role,
  `ColumnValues`: a number as `Vec<Option<i64>>` or `Vec<Option<f64>>`,
  text as `Vec<Option<String>>`, and a category as codes into levels
  that keep the storage type, so that the storage type is read from the
  values and stored nowhere else. A change of role builds the new shape
  from the values as stored (`Stored`, the four types the import reads).
  Any category, of countries or not, can be the active classification.
  The roles a column can take are worked out by the core and sent in the
  description, so that the window only gives them their words. Each value
  is `None` when missing, and a text is never empty: an empty cell is a
  missing value (`design.md`, section 7), and an empty text would become
  a level with no name when the column is made a category, so the
  constructor refuses it. `rust.md` asks for the values with "which rows
  are missing" apart, and never a NaN; an `Option` keeps the missing
  rows apart in the type itself, so no code can read a missing value as a
  number, where a vector of values with a mask beside it holds a
  placeholder in each missing row that a reader can take for data. It
  costs 16 bytes a row instead of 8 and a bit, 800 kB for a numeric
  column of 50,000 rows. A numeric value is always finite, checked when
  the table is built, since a project file could hold a NaN.
- **A category** holds, for each row, a code, `LevelCode(u16)`,
  that points into its ordered list of levels, or `None` for a missing
  value: in the active classification, an unassigned individual. A level has a
  name, unique within the column and not empty, and a colour. Codes on
  the wire are 16 bits with `0xFFFF` for missing (section 5), so a column
  has at most 65,535 levels. Levels that no row uses are allowed, which
  is how a new, empty group exists.
- **A colour** is three bytes of sRGB. Every categorical column has a
  colour per level, since any of them can become the active
  classification.
- **Each column has a revision**, the revision of the session (section 4)
  at which it last changed, so that a window fetches again only the
  columns that changed (`design.md`, section 4).

A table is built by one constructor that checks all of the above and
returns an error naming what failed: two columns of one name, a row of
one column missing in another, a code with no level, a non-finite
number. Every way a table reaches the core, the project file and the
import, goes through it, so a table in a session always holds these
rules.

The table has at most `MAX_ROWS` rows, 2^28, 268,435,456, and at most
`MAX_COLUMNS` columns, 2^24, 16,777,216. The limits come from the
messages: a part gives its length as a `u32` (section 5). A column of
8-byte values of 2^28 rows takes 2^31 bytes and a few dozen more for its
headers, half of the 2^32 a `u32` counts to, and the list of the
revisions of 2^24 columns, at 16 bytes a column, takes 2^28 bytes; so
every message of a table the constructor accepted can be encoded. The
limit on columns leaves room to spare, and no table of individuals has
16 million columns. `rust.md` sets the row index at `u32`; this limit is lower and
leaves `u32::MAX` free to mean "no row" in the hover. The tables of the
app have tens of thousands of rows.

## 3. The session

The session is the one owner of the shared state (`design.md`, section
3). The app holds it once, in a `Mutex`, and every command takes that
lock (`tauri.md`). It is in one of two states: no project open, or a
project open, as `enum Project { None, Open(OpenProject) }`, so that a
command on the table with no table loaded is a refusal the type makes
the code write, not a check that can be forgotten.

`design.md`, section 3, divides the state into three tiers by who shares
it and whether it is undone. `OpenProject` holds the first two:

- **The document**: the table, with its columns, types, levels and
  colours, and the undo and redo history of edits to it. It is what the
  project file saves, the history apart.
- **The interaction**: the active classification, the selected
  groups, the button + or − pressed on them, the selection and the
  hover. The active classification, the
  selected groups and the button are one value, `Option<Active { column,
  selected: SelectedGroups, mode: Option<EditMode> }>`, so that a
  selected group cannot exist without the classification it belongs
  to; a selected group is a value of the active classification
  (`design.md`, section 1), so changing the active classification clears
  them. `SelectedGroups` holds the codes of the groups in ascending
  order, each once, and whether the unassigned individuals are
  selected. The button is `None` whenever nothing is selected, + only
  with exactly one row selected, and − only with a group among them; the
  type allows the others, and the dispatcher
  keeps them out: every command that selects something else, or nothing,
  sets the button to `None` in the same value. Should one be made all the
  same, the writer of the messages refuses it as a defect, so that it
  never reaches a window. The selection is a `RowSet` with as many bits as the table has
  rows. The hover is an `Option<RowIndex>`. The filter of the find bar
  (`design.md`, section 2.1) is a `Filter`, the column searched or any,
  its condition, and whether it is showing the rows that match or those
  that do not. Beside it are the decimal mark the last
  `set_filter` gave, the one its window writes numbers with, which an
  edit finds the rows shown with, or none after a load; and the rows the
  filter shows, in order, or none for every row, with the revision at
  which they last changed. A load gives a filter of no text.
- **The window's own** state, the camera of a 3D view or the scroll of
  the table, is not in the session.

Because the history and the interaction are inside `OpenProject`, loading
a table replaces all of them with the table: nothing of the old project,
an edit to undo, a hover beyond the new number of rows, a selection of
the old length, survives into the new one.

Outside `OpenProject`, the session holds what lasts across projects: the
revision, the hover's sequence number `HoverSeq(u64)` (section 5), the
revision at which the current table was loaded, and the subscribers of
section 5. The revision belongs to the session, not to a project: it
keeps growing when another project is opened, so a window cannot take a
message about the new project for one about the old.

## 4. Commands and the dispatcher

Every change to the document or the interaction is a `Command`, an enum.
The dispatcher is the one function that applies a command to the
session, `Session::dispatch(&mut self, request)`, and every Tauri command
that changes something calls it. A
request is the command, the revision of the window's copy when it made
the command, and the time the window gave, which the core copies into the
message and never reads a clock for (`tauri.md`). A command from the
backend itself, the menu's Undo, gives the current revision and no time.

### Whole or not at all

The dispatcher works in two steps. The first checks the command against
the session and builds a plan, everything the change needs: the rows, the
codes, the new revision, the reverse for undo, and the bytes of the
message it will send. It can fail, and it changes nothing: it reads the
session through `&self`, so the compiler refuses a change there. The
second applies the plan. It first finds what it changes, the open project
and the column of a lasso, which the first step has just checked, so it
fails only on a defect of the code and before anything is changed; from
there it only assigns the values the plan holds, takes the step of the
history and sends the message, none of which can fail. All the arithmetic that can overflow, the next revision and the
length of each part included, is done in the first step, with
`checked_add` and `try_from`.

The revision and the hover's sequence number are `u64`, and a window
reads them as JavaScript numbers, which are exact up to 2^53 − 1. The
first step refuses, as a defect, a revision or a sequence number that
would pass it. At a thousand commands a second that takes 285,000
years, so the refusal is never met, but it is what keeps a window from
reading a wrong revision in silence.

A refused command leaves the session as it was. Each refusal has a test
that compares the whole session before and after it, every field but the
subscribers: the table, the history, the interaction, the counters of
ids and labels, the revision and the revision of the load. When a window
meets a defect of the app, it shows a red bar that says "Your data has
not been changed" (`design.md`, section 12), and this is what makes it
true. The test is shown to fail on a version of a command broken on
purpose to change one field before it refuses.

### The revision only grows

A command that changes something takes the next revision, `r + 1`, and
sends one message to every window. One command is one revision and one
message, even when it changes several things: undoing an assignment to a
group changes the codes and what can be undone and redone, and both
travel in the same message (section 5). A window then never shows half
of a command.

A command that changes nothing, a selection set to the one there is, a
lasso over individuals already in the group, takes no revision,
sends nothing and records nothing to undo, so that Undo always undoes a
change the user can see. The owner decided so on 2 October 2026.

A window checks that each message with a revision, every kind but the
hover, is one revision after the last it applied, and treats a gap as a
defect (`testing.md`). The dispatcher
sends every message while the session's lock is held, so the messages of
two commands cannot be sent out of their order. Commands in Tauri run
either on the main thread or, when `async`, on a pool of threads
(`tauri.md`), so two can run at once and only the lock orders them.

### Stale commands

A window makes a command from its copy, which can be behind: a lasso made
just before another project was opened names rows and columns of the old
table. Every value of a command is checked against the session: a column
id that is not in the table, a code with no level, a `RowSet` of the
wrong length. That does not catch a value that is valid in both tables,
such as column 3, which exists in both. So the dispatcher also refuses a
command made before the current table was loaded: the request's revision
is lower than the revision of the load. Such a command reaches the
backend after the load, and is refused then; the window receives the
message of the load on its channel, which replaces its copy with the new
table, whether before or after the refusal. The window shows the user
nothing of such a refusal and writes it to the app's log, because the
user's own action, opening the other project, has already replaced what
the command was about (decided by the owner on 2 October 2026).

A command also names what it acts on rather than leaning on the
session's current value. Assigning rows names the column and the one
row selected, and is refused unless they are still the active
classification and what is selected, as `NotSelected`: otherwise a lasso
drawn while group A was selected would land in group B, which another
window selected a moment before. Removing rows names the whole
selection the same way, and leaves unassigned the rows inside the lasso
that are in one of its groups, and leaves the others as they are.

Within one table, a column id is never given twice and rows do not
change. A level can be removed, by deleting a group or undoing one
added, inserted before others, by undoing a deletion, and the levels can
be built again, by a change of role, so a code can come to mean another
group: China, added as code 2 and then undone, and Japan, added
after it, are both code 2; Peru, code 1, is code 0 once Spain, code 0,
is deleted. Each column therefore keeps a second revision, that of its
levels, `levels_at`: the load, a change of role, a level removed or a
level inserted before the last sets it, and a level added after the last
level, or one renamed or given another colour, does not, since every
code keeps its meaning. A command that names a level, selecting a
group, assigning rows to one or removing rows from one, pressing +
or − on one, deleting or editing one, is refused as `LevelsChanged` when the
column's levels changed after the request's revision. The age of the
levels is checked before anything else the command names, so that a
command on a group undone and not added again is refused so too,
and not as a level that does not exist. A window treats it as it treats
`MadeBeforeLoad`: it shows nothing and writes it to the app's log, since
the change of the levels has reached its copy already. It is a revision
of the levels alone, so that a lasso, which changes codes and not
levels, does not make a lasso in another window stale.

### Undo

Each command on the document is turned into an `Edit`, and applying an
edit returns the edit that reverses it, which goes on the undo history.
Undo applies the reverse and puts its own reverse on the redo history; a
new edit clears the redo history. Assigning rows to a group becomes
`SetCodes { column, changes }`, with the rows whose code changes and
their new codes, and its reverse is the same edit with the codes they
had. Only rows that change are stored, 8 bytes each in memory, a
`RowIndex` and an `Option<LevelCode>`: a lasso over all of 50,000 rows
stores 400 kB.

A value typed in the table's cells (`design.md`, section 2.1) is the
command `SetCells { column, rows, text, decimal_mark }`: the rows are
one, or the selection's when "Apply to all selected rows" is ticked, and
the text is read by the column's storage type in
`crates/vavilov-core/src/cells.rs`, a decimal number with the window's
decimal mark and a point refused where the mark is another, so that
`1.500` typed in Spain is not one and a half; an empty text is a missing
value. A text that does not fit is refused as `CellRefused`, with the
column's name, the text, and a `CellRefusal` that says why: not a whole
or a decimal number, a latitude or a longitude out of its range, neither
`TRUE` nor `FALSE`, no country, none of a category's values (a new value
of a category waits for the owner's design), an empty ID or one another
individual has. In a category the value becomes `SetCodes`; in a column
of numbers or text, `SetCells { column, changes }`, the rows whose value
changes with their new values, each of the column's storage type; in the
first column, `SetNames { changes }`, one row only, since one ID given
to several rows would repeat it, a defect when a window sends more. Each
stores only the cells that change, and its reverse is the same edit with
the values they had. None changes the shape of the table, and a value
every row has already changes nothing.

A group added in the groups panel (`design.md`, section 2.1)
is the command `AddGroup { column, name, decimal_mark }`, on the
active classification alone. The name is put in Unicode's composed form
(`text.rs`) and read in `cells.rs` as a level of the column's storage
type, with spaces around it ignored, a decimal number with the window's
decimal mark, −0 as 0, `TRUE` or `FALSE` in any case, and a country as
its three-letter code. It is refused as `GroupRefused`, with the
column's name, the text, and a `GroupRefusal` that says why: an
empty name, one with a control character or a mark of the direction of
the text, one a group has already (`Taken`, with that group's
code, so that the window names it as it shows it), not a whole or a
decimal number, no country, neither `TRUE` nor `FALSE`, a name of text
of more than `MAX_GROUP_NAME`, 30, characters, or a column of
65,535 levels already.

Every text that enters the core is in Unicode's composed form, NFC
(`text.rs`, `design.md`, section 12): the import composes the IDs, the
column names and the texts of the file, and refuses as
`IndividualWrittenTwoWays` or `ColumnWrittenTwoWays` two IDs or two names
that become one; a text typed in a cell, a group's name and the
text of the find bar are composed before they are read. The level is
added after the last level, with the first colour of the list of
`design.md`, section 5, that no level of the column has; when the levels
have all 21, it takes the colour a level at its place takes on import,
so that the list starts again. The codes do not change, and the
new group is selected for editing in the same command.

A group deleted is the command `DeleteGroup { column,
group }`, on the active classification alone: the rows that held
it are left unassigned, each group after it takes the code before
its own, and a group selected for editing keeps being selected at
its new code, or, when it is the one deleted, nothing is selected and
the button pressed is released. A group edited is
`EditGroup { column, group, name, colour, decimal_mark }`: the
name is read as for `AddGroup`, and refused for the same reasons
but `TooMany`, a name the group has already being its own; the
colour is one of the list, and another is a defect, since the window
offers no other. The same name and colour change nothing.

Three edits change the levels. `InsertLevel { column, code, level,
colour, rows }` inserts a level at `code`, the levels from there on
taking the code after their own, and gives it `rows`, which hold no
level: a group added, last and with no rows, or a deletion undone.
Its reverse is `DeleteLevel { column, code }`, which deletes the level,
leaves its rows with none and gives back the `InsertLevel` with those
rows: a group deleted, or an addition undone. `SetLevel { column,
code, level, colour }` gives a level another value and colour, and its
reverse is the same edit with those it had. Each sends the shape, the
codes and the column's revision, the active classification when the
command sets it, and the rows the filter shows when they change, since
a name changed, a level gone or its rows given back can change which
rows the filter's text matches.

While + or − is pressed (`design.md`, section 2.1), the selection
assigns. `SetEditMode { column, selected, mode }` presses a button on
what is selected, which it names whole, or releases it with `None`; it
is refused as a lasso is, as `NotSelected`, when `selected` is not what
is selected. + with other than one row selected, and − with no group
among them, are defects, since no window offers them. Pressing one gives the
rows selected now what it gives the rows that enter the selection after,
in the same command. `SetSelection`, while a button is pressed, assigns
the rows that enter the selection, those in the new selection and not in
the old: + gives them the group, or none for the unassigned
individuals, and − leaves unassigned those in any group selected. A row
already where the button puts it, or one that leaves the selection, is
not changed. Either command is then one edit, `SetCodes`, whose message
carries the selection or the active classification beside the codes, and
one undo; undoing it gives the codes back and leaves the selection and
the button as they are. `SelectGroups { column, selected }` selects
groups; any other selection, another classification, a group added, a
load, a change of role, and a group deleted or undone that was among
those selected, release the button in the same command.

- **Undo restores the data, not the revisions.** An undo is a command
  that takes the next revision, and the columns it touches take that
  revision too, so that a window that cached a column fetches it again.
- **The interaction is not undone.** It is kept valid after every edit
  instead: when a later edit can remove a column or a level, the
  dispatcher clears an active classification or a selected group
  that no longer exists, in the same command.
- **A test for every edit** applies it and its reverse to a small table
  and compares the table with the one it started from, field by field,
  and then redoes it and compares with the table after the edit.
- **The history belongs to the project** (section 3): after a load
  there is nothing to undo, which a test checks with an edit made before
  the load.
- The history has no bound in the first slice. Its memory has not been
  measured; a bound would change how far back the user can undo, and is
  proposed to the owner if it is needed.

## 5. Subscribing and the messages

### Subscribing

A window subscribes when it starts and again after a reload: it gives the
backend its channel and gets back a snapshot, the whole shared state at
one revision. `Session::subscribe(label, subscriber)` registers the
window's subscriber and returns the snapshot at the current revision `r`,
in one call on
`&mut Session`, so in one hold of the lock: no change can fall between
the two. A window that subscribes again, after a reload, replaces its
subscriber; the session keeps one per label.

A subscriber is the core's trait for the window's end of a channel:

```rust
pub trait Subscriber: Send {
    fn send(&self, message: Vec<u8>) -> Result<(), SendFailed>;
}
```

The app implements it over a Tauri `Channel<InvokeResponseBody>`, the
test program of the e2e harness by passing the bytes to the harness, and
the tests of the core by recording what they receive.

- **A closed window is unsubscribed by the app**, from Tauri's event
  that the window was destroyed. A failed send cannot be relied on for
  it: Tauri's `Channel::send` returns `Ok` when the window's web view is
  gone (`tauri-2.12.1/src/ipc/channel.rs`, the `is_registered` checks).
- **A subscriber whose `send` fails** is removed, and the dispatcher
  returns its label and the reason to the app; the command itself has
  been applied and is not failed for it. The window then receives
  nothing more until it subscribes again, so the app reports the failure
  as a defect and reloads the window if it is still open.
- **Which windows may subscribe is the app layer's** (section 7): the
  main window, and a window of widgets the app layer keeps open. It
  refuses another before it reaches the session, and closes it.

The snapshot comes back as the response of the subscribe command, and the
channel can deliver a message before the window has read that response.
So a window keeps what its channel delivers until its snapshot arrives,
and then goes through it in the order it arrived, by kind:

- a message with a revision is dropped when its revision is `r` or
  lower, which the snapshot already holds, and applied otherwise;
- a hover is applied only when its sequence number is higher than the
  snapshot's. The revision in its header plays no part.

What a window asks for itself with a
command, rather than receives on its channel, the description of the
table and each column it draws, comes with the revision it was read at,
so the window can tell which of two copies is newer.

The description gives, with each level of a column whose role is
country, the country it is, `{ "name": "Spain", "numeric": "724" }`: its
common name and its ISO numeric code, three digits, `null` for a former
country, from the core's list of countries (`design.md`, section 6). A
level of a column of countries that is no country's code is a defect.

### The layout

Every message has a header of 24 bytes and then a list of parts. All
numbers are little-endian, the order of every platform the app targets.

| bytes | field |
|---|---|
| 0 | the kind of message: 0 snapshot, 1 change, 2 hover, 3 rows, 5 numbers (below); 4 and 6 are the app layer's, which the session hands on unread (section 7): 4 an item of the menu, in this layout (section 8), and 6 a window's list of widgets, in a layout of its own (`src-tauri/src/widgets.rs`, `WidgetList::to_bytes`) |
| 1 | flags: bit 0 set when the time below was given, the other bits zero |
| 2 to 7 | zero |
| 8 to 15 | the revision, `u64` |
| 16 to 23 | the time the sending window gave, `f64` milliseconds, or zero when bit 0 is clear |

A part is a header of 8 bytes, its kind as a `u16`, two zero bytes and
the length of its payload in bytes as a `u32`, then the payload, padded
with zeros to a multiple of 8. Every payload then starts at an offset
that is a multiple of 8, and a window reads its codes or its values with
a typed array over the message's `ArrayBuffer`, without a copy. The
parts of the first slice:

| part | payload |
|---|---|
| project | whether a project is open, a byte, and seven zero bytes; when one is, the number of rows, `u32`, four zero bytes, and the revision at which its table was loaded, `u64` |
| active | the active classification's column id, `u32::MAX` for none; the button pressed, a byte, 0 none, 1 +, 2 −; whether the unassigned individuals are selected, a byte, 0 or 1; the number of groups selected, `u16`; their codes, `u16` each, in ascending order |
| selection | the number of rows, `u32`; four zero bytes; one bit per row, row `i` in bit `i % 8` of byte `i / 8`, the unused bits of the last byte zero |
| codes | the column id, `u32`; four zero bytes; the column's revision, `u64`; one `u16` per row, `0xFFFF` for missing |
| undo | whether there is something to undo and something to redo, a byte each |
| columns | the number of columns listed, `u32`; four zero bytes; then for each its id, `u32`, four zero bytes and its revision, `u64` |
| hover | the hover's sequence number, `u64`; the row, `u32`, `u32::MAX` for none |
| shape | the revision at which the columns, their names or their roles last changed, `u64`: the load, or a change of role. A window asks for the description of the table again when it grows |
| filter, 13 | the revision at which the rows shown last changed, `u64`; the number of rows shown, `u32`; the column searched, `u32`, `u32::MAX` for any; a byte each for the kind of the condition (0 contains, 1 is, 2 a group, 3 a comparison, 4 is missing), its comparison (0 `<`, 1 `≤`, 2 `=`, 3 `≥`, 4 `>`, and 0 for the others), the rows the filter is showing (0 those that match, 1 those that do not), whether bits follow, and whether the comparison's text cannot be read as a number with the decimal mark kept; a zero byte; the group's code, `u16`, `u16::MAX` for none; the text, as a text list of one, empty for a group and for is missing; and while the filter does not show every row, padded to a multiple of 8, one bit per row, set for a row shown, in the order of the selection's bits |

A snapshot carries every part, with every column in the columns part. A
change carries the parts of what the command changed, by two rules that
hold for every command:

- every column whose revision changed is listed in a columns part, so
  that a window that draws it, the active classification or not, fetches
  it again;
- the codes of every category whose revision
  changed travel in a codes part, whichever column it is: undoing a lasso
  on a column that is no longer the active classification still reaches
  a bar plot of that column. So a column listed in the columns part with
  no codes part beside it is no longer a category,
  and a window drops its codes.

So a lasso sends codes, columns and undo; a new selection sends
selection. An edit that changes which rows the filter shows also sends
the filter part, at its revision; one that changes none of them does
not, so that the pages a window holds stay good. The rows shown after an
edit are found while it is planned, on the values it gives, before
anything is changed. Loading a table sends every part, as a snapshot does, with a
new hover sequence number and no hover. Parts let one command change
several things in one message without a kind of message for every
combination.

A window decodes every length against the bytes it has, refuses a
reserved byte that is not zero, and treats an unknown kind as a defect.
The backend and the windows are built together and ship in one app, so a
message needs no version: a new part or a new kind is added to the Rust
encoder and the TypeScript decoder in the same commit, and each side has
a test against the same literal bytes (`testing.md`). The zero bytes are
checked so that a later use of them cannot be read as zero by a window
that was not changed.

### A page of rows

The table of the main window draws only the rows on screen and asks the
backend for them a page at a time (`design.md`, section 2.1). The
command `fetch_rows` takes, as JSON, the position of the page's first
row among the rows the filter shows, from 0, which with no filter is its
row (a `Position` in the core), the number of rows, the ids of the columns wanted, in the order wanted,
and the revision of the window's copy, `{ first, count, columns,
basedOn }`.
It changes nothing and takes no revision. It is refused as a command
made before the current table was loaded when `basedOn` is older than
the load, which the window takes as stale (section 4); as
`RowsOutOfRange`, with the first position, the count and the number of
rows shown, `{ first, count, numShown }`, when the page goes past the
last row shown; and as
`UnknownColumn` for an id the table does not have, the first column's
included, since the names come with every page; and as a defect for a
column asked for twice, since a window asks for each once and a list of
repeated ids would make a page of any size from a short request.

The answer is raw bytes in the layout above, a message of a fourth kind,
rows, whose header has the current revision and no time, so that the
window can tell which of two pages of a row is newer and whether a page
is older than a column's last change. It is bytes and not JSON because a
JSON number cannot hold every 64-bit integer exactly, and a window would
read an integer of 2^53 or more as another. Its parts, in this order:

| part | payload |
|---|---|
| page | the revision at which the table was loaded, `u64`; the revision at which the rows shown last changed, `u64`, so that a window drops a page of the rows shown before; the revision at which the names of the individuals last changed, `u64`, so that a window drops a page of names an edited ID replaced; the position of the first row, `u32`; the number of rows, `u32`; then the row of the table each is, a `u32` each |
| names | the names of the page's rows, as a text list (below) |
| values, one per column asked for | the column id, `u32`; a byte, 0 decimal numbers, 1 whole numbers, 2 text, 4 the codes of a category, and 3 not used; three zero bytes; the column's revision, `u64`; then its values |

The values of a category are its codes, one `u16`
per row, `0xFFFF` for missing, as in a codes part. Those of a number or
text
start with which rows are missing, one bit per row of the page, set when
missing, in the order of the selection's bits, the unused bits of the
last byte zero, padded with zeros to a multiple of 8 bytes. Then:

- decimal numbers, an `f64` per row; whole numbers, an `i64` per row.
  A missing row holds zero, which the window checks, so
  that no value stands in a missing row a reader could take for data.
- text, a text list, in which a missing row has an empty text.

A text list is the end of each text, as an offset into the bytes that
follow, one `u32` per row after a first 0, then the texts one after the
other in UTF-8. A window that finds an offset that goes back or past the
bytes, or bytes that are not UTF-8, treats the message as a defect.

### A numeric column

A point view draws whole columns, not pages: a 3D scatter asks for the
three columns on its axes with `fetch_column`, which takes, as JSON, the
column's id and the revision of the window's copy, `{ column, basedOn }`,
and changes nothing (`design.md`, section 4). It is refused as a command
made before the current table was loaded when `basedOn` is older than the
load, as `UnknownColumn` for an id the table does not have, the first
column's included, and as `NotNumber` for a column whose role is not a
number, a latitude or a longitude.

The answer is raw bytes, a message of a fifth kind, numbers, whose header
has the current revision and no time, with one part, numbers, 14:

| part | payload |
|---|---|
| numbers, 14 | the column id, `u32`; four zero bytes; the column's revision, `u64`; the number of rows, `u32`; four zero bytes; the middle of the column's values, `f64`, the half-way point of the smallest and the largest, 0 with every row missing; which rows are missing, one bit per row in the order of the selection's bits, padded with zeros to a multiple of 8; then an `f32` per row, its value's distance from the middle, zero in a missing row |

The distances are 32-bit floats, as the GPU draws them, written by one
function of the writer (`rust.md`, "Floats"), and the window adds the
middle back in its own 64-bit numbers. A 32-bit float keeps about 7
significant digits, and the distances keep them of the spread of the
values rather than of their size: positions on a genome or coordinates in
metres, 4,500,000.05, 4,500,000.10 and 4,500,000.15, would all become
4,500,000 as 32-bit floats of their own (decided by the owner on
3 October 2026, after the review of that day). A whole number goes
through the nearest `f64` first. A distance beyond about 3.4 × 10^38
becomes an infinity, which a window counts among the values it cannot
draw; a NaN, which the core never holds, is a defect, and so is a middle
that is not finite, or a missing row that holds anything but zero. The
message of a column of 50,000 rows is 206,320 bytes. The column's revision tells the window
whether the values are those of its copy: it uses them only when the
revision is the one its copy has for the column, and asks again when the
copy's grows.

### The filter

The command `set_filter` takes the filter of the find bar as JSON, `{
column, condition, showing, decimalMark, basedOn, sentAt }`, with
`column` an id or `null` for any column, `condition` one of `{ kind:
"contains", text }`, `{ kind: "is", text }`, `{ kind: "group", code }`
with `code` a group's or `null` for none chosen, `{ kind: "compare",
comparison, text }` with `comparison` `less`, `atMost`, `equal`,
`atLeast` or `greater`, and `{ kind: "missing" }`, `showing` `matching`
or `notMatching`, and `decimalMark` the decimal mark
the window writes numbers with, its system's region's. The core keeps
the decimal mark beside the filter, not in it, and finds the rows shown
after an edit with it. It refuses as a defect a decimal mark that is not
one to three characters, since macOS gives one and Windows at most three,
and a text of more than `MAX_FILTER_TEXT`, 1,000 characters, the limit
of the find bar's field, since the text is sent back in every message
that changes the filter, to every window. It refuses a column the table
does not have as `UnknownColumn`, with a text or not, and as a defect a
condition that does not fit its column, the operators the find bar
offers it: "contains", "is" and "is missing" for the IDs, a column of
text and any column; "contains", a group and "is missing" for a category
or a column of countries; a comparison and "is missing" for a number, a
latitude or a longitude. An empty text, a group not chosen and a
comparison's text that is no number show every row. An edit that leaves
the filter unfit, a column of another role or the group deleted, clears
it to the column's first operator with no value, "=" for numbers and
"contains" for the others, in the same message; a group of the filter
follows its code when the groups are renumbered, by a group deleted or
its undo (`filter::fitted`). The core finds the
rows in
`crates/vavilov-core/src/filter.rs`: a cell matches by the text the
table shows of it, a decimal number written as JavaScript's `String`
writes it, in the fewest digits that give back the value and, of two
such forms equally close to it, the one whose last digit is even, with
the window's decimal mark, yes and no as `TRUE` and `FALSE`, a level as
its value; case is ignored, by `to_lowercase` on both sides, and accents
are not; a level of a country matches also when the text is part of one
of its ISO names, or equals one of its codes of two or three letters,
which are compared whole so that a one-letter text such as `j` does not
find Benin by its code `BJ`; the code the table shows matches as part,
as every cell's text does, so `es` finds Spain by its code `ES` and
Estonia by its shown code `EST`, as the owner wants (2 October 2026); a
missing cell never matches. With any
column, a row matches when one of its cells does, the first column's
included. The same filter with the same decimal mark again changes
nothing. The filter is part of the interaction and is not
undone.

The rows are found under the session's lock, on every key typed and
after every edit while the filter has a text, so every window waits for
them. Measured on the owner's Mac (Apple M5 Pro), in a release build,
on a table of 50,000 rows shaped as the demo's, with six columns of
decimal numbers, one of whole numbers, four categories and a text, each
`set_filter` of a key typed, the median:

| search | 2 October, first | 2 October, after two fixes | 3 October, texts kept |
|---|---|---|---|
| any column, a text with a letter other than `e`, `collected 19` | 445 ms | 2.5 ms | 2.5 ms |
| any column, a text of digits, `0,5` | 447 ms | 82 ms | 8.4 ms |
| one column of decimal numbers, digits | 80 ms | 14 ms | 0.8 ms |
| one column of text, or a category | 1 ms | 1 ms | 1 ms |
| a change of role while any column is searched for `e` | 459 ms | 93 ms | 20 ms |

The first fix: writing a decimal number as JavaScript does wrote its
exact digits, 800 of them, for every number whose last digit is odd, to
settle a tie that almost never happens; it now writes them only when a
tie is possible. The second: a text with a character that no number's
text has, anything but digits, `+`, `-`, `e` and the decimal mark,
skips the columns of numbers. The third, decided by the owner on
3 October 2026: the open project keeps the text of every decimal
column, written with the window's decimal mark
(`crates/vavilov-core/src/filter/texts.rs`), and writes a column's again
only when the column's revision or the mark changes; the column an edit
replaces is written afresh for that edit. The first key after a load or
an edit pays for the writing, 77 ms for the six columns above, and the
texts take about 3.4 MB for them. They are not part of the state: a
refused command may have written them, and two sessions are compared
without them.

The find bar keeps as its own the whole filter the user asked for last,
its column, operator, value and checkbox, with the load of the table it was made
for, and draws it while it is pending; otherwise it draws the backend's
filter (`src/state/findDraft.ts`). At most one `set_filter` is on its
way: a change made meanwhile waits, and the newest is sent once that
one is answered, so that typing fast sends no queue of texts. The
pending filter is dropped when the backend's filter becomes it, when
another table is loaded, which clears the filter and the field, and when
the command that carried it is answered stale, refused or failed, so
that no older filter is sent after a newer one. A message of an older
filter, sent before the user's last change, does not take the field
back. A shift-click
over a filtered table selects the rows shown between the two rows
clicked, and none the filter hides. When the field's text is set from
outside, by a filter the core cleared or by a load, the bar draws a new
field: WebKit and Chromium keep a field's history of typing after its
value is set by code, and Undo and Redo then mix the old text in, so that
`12` undone and redone gave `3312` (seen on 4 October 2026, in both
engines).

### The hover's sequence number

The hover takes no revision (`design.md`, section 4), so that hovers can
be dropped on the way, by the queue described below if it is ever
needed: a dropped message with a revision would leave a gap that a
window treats as a defect. Every new hover increments `HoverSeq`, and the hover message carries it in its hover part;
the header's revision is the current revision, unchanged, and a window
does not check it for gaps. A window keeps the hover with the highest
sequence number it has seen, the snapshot's included, so that a hover
that arrives before the snapshot it follows is not applied over it.

The core keeps no queue of hovers, as the owner decided on 2 October
2026; `design.md` had said the backend drops a hover it has not yet
sent, and now says this. A hover replaces the last one and is handed to
every subscriber at once. The hover is a synchronous Tauri command, which runs
on the main thread, and from there Tauri hands a channel's message to
the web view within the call (`tauri-runtime-wry`, `send_user_message`),
so no hover waits in the backend to be dropped. A web view slow to run
them would hold its own queue of hovers and draw each in turn, behind
the pointer. On the owner's Mac a hover reached the other window in 1
to 3 ms at the median (`spikes/windowing/README.md`); on Windows and
Linux it has not been measured. If hovers pile up there, a queue per
window that keeps only the newest goes into the app, and the sequence
number is what lets it drop hovers without breaking the revisions. The
core's tests check the sequence number: it grows with each hover, and hovers between two changes leave the revisions without a gap.

## 6. Errors

The core has one error enum, `CommandError`, written with `thiserror`
and serialised by `serde` as an object with a
`kind` and the data its message needs (`tauri.md`, "Errors across the
boundary"):

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CommandError {
    #[error("no project is open")]
    NoProject,
    #[error("column {column} is not in the table")]
    UnknownColumn { column: ColumnId },
    #[error("column {column} has {num_levels} levels and no level {code}")]
    UnknownLevel { column: ColumnId, code: u16, num_levels: u32 },
    // ...
    #[error("defect: {what}")]
    Defect { what: String },
}
```

It is the core's and not the app's so that the app and the test program
of the e2e harness return the same errors in the same shape. It holds the
refusals about the data alone: those about the windows are the app
layer's (section 7), in its own enum, `WindowError`, with `UnknownWindow`,
`UnknownWidget` and `WindowFailed`; the app's `AppError` is either, and
crosses to a window as this one does, untagged, so that the window reads
both kinds in one table (`src/state/commandError.ts`). A Tauri command
that touches no window returns `Result<T, CommandError>`, one that does
`Result<T, AppError>`, and a poisoned lock is a `Defect`.

- `rename_all` names the kinds in camelCase; `rename_all_fields` does the
  same for the fields, which `rename_all` alone leaves in snake_case.
- The `#[error]` text is for the technical details a user copies into a
  report of a defect, and for logs. The words a user reads are written by
  the window from the kind and the data (`writing` skill, "The text of
  the app").
- No case holds a type of a dependency. `std::io::Error` is not
  serialisable, so a case of a failure of the disk holds the file's
  name, an enum of our own for the kind of failure, `IoFailure`, and the
  system's message as text. That field cannot be named `kind`, which
  serde refuses beside the tag `kind`; it is named `io`.
- The cases of the import and the export (section 8): `ImportRefused`, a
  file the import refused, with an `ImportRefusal` that says why;
  `ImportUnreadable`, an xlsx too damaged to read, with the reader's
  message; `FileNotRead`, a file the disk did not give; `ExportRefused`,
  a table the export refused, with an `ExportRefusal` that names the
  column and the individual; and `FileNotWritten`, a file the disk did
  not take. Each that names a file carries its name without its folder,
  `plants.csv`, as the user saw it in the dialog, and never the path, so
  that no message shows the folders of the user's disk.
- The cases of the first slice: no project open; an unknown column; a
  column that is not categorical; a column that is not the active
  classification; an unknown level; no group selected; a group
  that is not the selected one; a row set or a row index that does not
  fit the table; nothing to undo or to redo; a command made before the
  current table was loaded; a label the session does not know; the
  refusals of the table's constructor (section 2); and `Defect`, for a
  state our code makes impossible, such as a revision that would pass
  2^53 − 1.

## 7. The windows are not the core's

The core knows the data and the calculations on it, and nothing of the
windows (`design.md`, section 3, decided by the owner on 4 October 2026).
It sends its changes to subscribers it knows by a name it does not read,
`Session::subscribe(label, subscriber)`, and forgets one with
`Session::unsubscribe(label)` when the app tells it the window is gone.
Which plots are open, in which window, which windows may subscribe, and
when a window opens or closes, are the app layer's:
`src-tauri/src/widgets.rs` keeps them without Tauri, so that the test
program of the e2e harness runs the same code, and `windows.rs` makes the
windows with Tauri. Which column a plot can show is the windows' rule
(`src/state/plotColumns.ts`, `widgetFits`): a window closes a plot it
cannot show, as after a change of role.

The one question the app asks the core about a plot is whether the
window that asked for it did so from a copy of the table now loaded:
`Session::check_based_on(based_on)` refuses one made before the load as
`MadeBeforeLoad`, since its column ids may name other columns now.

The app opens, brings forward and closes the windows through its trait
`WindowHost`, once its locks are released, since a new window subscribes
as it starts, which takes them, and in Tauri a window created from a
synchronous command deadlocks on Windows (`tauri.md`). When it forgets a
window, after a load or with its last plot, it first unsubscribes it from
the session, so that the window receives nothing more. A command that
takes both the session's lock and the widgets' takes the session's
first.

The app layer sends a window its own messages, an item of the menu to the
main window and a list of widgets to a window of them, through
`Session::send_to(label, bytes)`, which hands bytes the core does not read
to one subscriber, so that each window has one channel, the session's,
and the app keeps no copy of it. It gives `Delivery::Sent`,
`NoSubscriber`, for a window that has not subscribed yet, or `Dropped`,
for a subscriber that failed and was removed, as the dispatcher does.

## 8. The import and the export

`import.rs` and `export.rs` are the only modules that name `table_io`,
taken by git at the revision of its release `js-v0.2.0-dev.1`, c99b3e6
(`design.md`, section 7). `import_table` gives `table_io` the bytes of a
file, with the limits the owner chose, 20 MB and 2,000,000 cells of an
xlsx, and turns what it gives into the core's: each refusal into a case
of `ImportRefusal` inside `CommandError::ImportRefused`, with the file's
name, a line or a row and a column as the user will find them, and
whether they are those of a text file or of a sheet; the first column's
header checked as `IndividualID`; and the role of each other column
guessed by `design.md`, section 6, `MAX_GUESSED_LEVELS` distinct values
of text at most for a category. A table the core then refuses is a
defect, since `table_io` makes it impossible: a text is never empty
there, and a file of 20 MB has fewer rows than `MAX_ROWS`.

`export_table` gives `table_io` the columns as stored, a category as its
values and a category of countries as their codes, the first column
headed `IndividualID`, and turns its refusals into `ExportRefusal`
inside `CommandError::ExportRefused`, each place named by the column's
name and the individual's, which the core has and a window would have to
look up. `Session::table_to_export` copies the table under the lock, so
that the file is written once it is released.

`files.rs` is the one module of the core that touches the file system:
it reads the file of an import, refusing one larger than 20 MB from its
size before it reads it, and writes the file of an export to a temporary
file beside it, renamed over it, so that a failure leaves a file that was
there whole. The temporary file is always a new one, named
`.vavilov-<process>-<n>.tmp` with the first `n` from 0 that no file in
the folder has, and opened so that it fails on any file of that name,
a link among them: an export never writes or removes a file of the
user's other than the one chosen, never writes through a link into
another folder, and the name chosen can be as long as the system takes.
A file replaced keeps its permissions on macOS and Linux, so that a file
only its owner may read stays so. On a failure the temporary file is
removed, and a failure to remove it is written to the log.

The system's dialogs are the app's. A Tauri command, `import_table` or
`export_table`, opens them on the backend, so that no window sends a
path (`design.md`, section 2.1); `src-tauri/src/transfer.rs` holds the
steps between, which the test program of the e2e harness runs too, with
the file a test picked in the place of the dialog's.

### The menu's actions

The menu is the app layer's, not the core's (section 7), and an item the
user chooses in File or Edit is carried out by the main window, so that
the window shows the answer of the command, a refusal in its information
bar, as it would for a control of its own. The app layer
(`src-tauri/src/actions.rs`) hands the item to the window through
`Session::send_to` as a message in the core's layout, of the kind action,
4, whose header has the current revision, which takes no part in the
order, and whose one part, kind 12, holds the item's code as a `u16`,
1 Import table…, 2 Export as CSV…, 3 Export as Excel…, 4 Undo, 5 Redo,
and six zero bytes. An action changes no state. Undo and Redo
are carried out by the window, with the revision of its copy, like any
command it sends, so that an undo made from a stale copy is refused. The
backend enables them while the session has something to undo and to
redo, after every command and every load. A window keeps an action that
comes before it listens for one, as while it starts.

## 9. The first slice, and what comes later

The first slice is the core without files, with tests:

- the workspace and the crate of section 1, with the lint table moved,
  and the checks run at the root;
- the newtypes, `RowSet`, the table and its constructor with every
  refusal of section 2, tested on tables written in the tests;
- the session with no project and with one, and a command that loads a
  table into it, which the project file and the import will both use;
- the commands: set the selection, set the hover, set the active
  classification, select a group, assign rows to the selected
  group or remove them from it, undo and redo;
- subscribe and unsubscribe, the snapshot, the broadcast, and a
  subscriber that fails;
- the encoder of the messages of section 5, each part tested against
  literal bytes;
- `CommandError` with the cases of the first slice.

Its tests include:

- every refusal leaves every field of the session as it was;
- every edit and its reverse give back the table, and redo gives back
  the edited one;
- after a load there is nothing to undo, and a command made before the
  load is refused;
- a lasso is refused when another group was selected after it was
  made;
- a subscriber that subscribed at `r` receives `r + 1` and then every
  revision with no gap, with hovers in between that take none. The
  atomicity itself is held by the signature, one call on `&mut
  Session`, so no test can break it; the test checks what the window
  relies on, that the snapshot's revision and the first message's agree;
- undoing a lasso on a column that is no longer the active
  classification sends its codes and its revision;
- a label the session does not know is refused;
- the boundaries: a table of zero rows; a selection of 8 and of 9 rows,
  whose last byte has unused bits; a `RowSet` with an unused bit set; a
  column of 65,535 levels and one of 65,536; a revision at 2^53 − 1.

Later, each in its own slice:

- the import through `table_io`, with the guess of categorical columns,
  the order of their levels and their colours;
- the commands on the shape of the table: adding, removing and renaming
  columns, changing a type (`design.md`, section 6), renaming and
  removing groups, changing a colour (a group is added since
  3 October 2026, section 4);
- the description of the table as JSON and the fetching of columns, with
  their layouts (built: the description, the pages of rows, and a
  numeric column whole, section 5);
- the widgets and `WindowHost`, with the e2e test program (built on
  3 October 2026, and moved to the app layer on 4 October 2026, section
  7), and the layouts of `design.md`, section 2.4;
- the project file, a zip of Parquet and JSON (`design.md`, section 8),
  whose two crates the owner has not approved, and the flag of unsaved
  changes;
- export.

## 10. Decided by the owner, and still open

Decided by the owner on 2 October 2026, and written above where each
applies:

- A command that changes nothing, such as a lasso over individuals
  already in the selected group, leaves nothing to undo
  (section 4).
- The core keeps no queue of hovers; one is added to the app only if
  hovers are seen to lag on Windows or Linux (section 5). `design.md`,
  `tauri.md` and `testing.md` were changed to say so.
- A window shows nothing of a command refused because another project
  was opened after it was made, and writes it to the app's log
  (section 4).
- `serde_json` is a development dependency of the core, to test the
  shape of `CommandError` as a window receives it. It is in `Cargo.lock`
  already, through Tauri, and is maintained with `serde`.
- The levels of a categorical column made by the import are in the order
  of their names with case ignored, ties broken by the exact text, so
  that `pop1`, `Pop2` and `pop10` come in that order (`1`, `10`, `2` by
  their characters). The numbers inside a name are not compared as
  numbers: names such as `pop1a` would make it a rule of many cases.
- The colours of the levels are Okabe and Ito's list without its black,
  which is hard to see on a dark background: seven colours, from orange,
  in the list's order. The levels after the seventh go through the list
  again mixed with 40 % white, then with 40 % black, 21 colours in all.
  The owner saw them in the app on 2 October 2026; a column of more than
  21 levels starts the list again, accepted for now and reviewed when
  there are more groups and views.

Decided by the owner on 3 October 2026: the mode is the button + or −
pressed on the selected group, kept in the interaction, one for all
windows (section 3), so that a lasso in a plot does what a click in the
table does (`design.md`, section 2.1).
