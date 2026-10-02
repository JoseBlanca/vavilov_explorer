# The design of Vavilov Explorer

2 October 2026, before any code. This document records the design the
owner agreed that day for the first version of Vavilov Explorer. It
covers what the user works with, the windows, where the shared state lives
and how it reaches each window, the table and the project file, the
platforms, and how all of it is tested. Decisions still open are in
section 11. What an earlier prototype taught, about rendering, the map
and the lasso, is in `prototype-lessons.md`. That document is the
starting point for the views and is not repeated here. The library that
reads and writes tables, `table_io`, lives in its own repository and is
introduced in section 7.

## 1. What the user works with

Vavilov Explorer is used by biologists. They come with one table, usually
a CSV or an Excel file, with one row per individual (an accession, a
plant, an animal) and one column per variable: names, coordinates,
traits, principal components, the populations each individual is
assigned to.

- **Project**: the one file the app opens and saves, with the extension
  `.vav`. It holds the table and everything the user set up around it
  (section 8). The app has one project open at a time. Opening another
  project asks to save the current one and then replaces it.
- **Import and export**: CSV, TSV and xlsx files are never opened or
  saved. Import table… reads one into a new, untitled project, and Export
  as CSV… or Export as Excel… writes the table to a new file the user
  names. An imported file is never written to. This is how GIMP treats its
  own format and the formats it imports.
- **Classification**: a categorical column of the table whose values say
  which population each individual belongs to. A table can have several,
  for example one by country of origin and one from a genetic clustering.
- **Active classification**: the classification that colours every view.
  The user chooses it in the populations panel of the main window.
  Changing it recolours every window.
- **Population**: one value of the active classification.
- **Unassigned**: an individual whose value in the active classification
  is missing. It belongs to no population.
- **Selected population**: the population the user is editing. It is
  chosen by clicking it in the populations panel. While one is selected,
  the pointer is in one of three modes, as in the prototype: ↻ moves the
  view, + makes a lasso add the individuals inside it to the population,
  and − makes it remove them, which leaves them unassigned.
- **Selection**: a set of individuals, made by a lasso in a plot, by
  rows in the table, or by bars of a histogram. It is shown in every
  window. The selection and the selected population are different things
  and the interface keeps them apart.
- **Hover**: the one individual under the pointer, shown in every window.

The only cells the user edits are those of the active classification,
with a lasso in a plot or by choosing a population in a cell of that
column in the table. The other edits are to the shape of the table:
adding and removing columns, renaming them, adding, renaming and removing
populations, and changing the type of a column.

popnei, named in section 7, is the owner's population genetics
library in Rust, and popnei_web its web applications.

## 2. Windows

Each view is a window of its own. A single window with movable panels
was considered and not taken. It would need a docking system, which
neither the web views nor Tauri provide, and building one is a project
of its own.

### 2.1 The main window

The main window is a view of the table, with the populations panel beside
it.

- The table draws only the rows on screen, fetched from the backend a page
  at a time, so a table of tens of thousands of rows costs no more than one
  of a hundred.
- The table is linked like every other view. Selected rows are
  highlighted, clicking and shift-clicking rows selects individuals, and a
  filter shows all rows, only the selection, or only one population.
- On top of each column, a dropdown shows its type and lets the user
  change it (section 6).
- The populations panel lists the populations of the active
  classification, each with its colour, name and number of individuals. A
  dropdown above it chooses the active classification. It is where a
  population is selected and edited.
- With no project open, the main window shows an empty state: Open
  project…, Import table…, the recent projects, and dropping a file on
  the window, which opens a `.vav` and imports a CSV, TSV or xlsx. An
  import that fails says why, where in the file and what was found, for
  example "line 1,203: 14 fields, expected 12", and loads nothing. A
  separate launcher window was considered and not taken: it would be one
  more window to open and close, and the window would jump in size when
  the data arrived.

### 2.2 Widgets

A widget is a window with one view of some columns:

| widget | columns |
|---|---|
| 3D scatter | three numeric columns |
| histogram | one numeric column |
| bar plot | one categorical column |
| map | a latitude and a longitude column |

The same kind of widget can be open more than once, for example two
scatters of different principal components. A widget is created from a
Plot menu, which opens a small dialog to choose the columns, filled in
from the columns selected in the table. It can also be created by
right-clicking a column header or a group of selected headers. Both ask
the backend for the same thing.

Removing a column closes every widget that shows it. Undoing the
removal brings the column back but does not reopen those widgets.

Histograms and bar plots select too: dragging across bins or clicking a
bar selects the individuals in them, and the selected share of each bar
is drawn inside it. Each widget shows how many rows it cannot place, for
example "312 without coordinates". Those rows are still in every other
view.

Widgets are independent top-level windows, not child windows. In Tauri a
window can be given a parent. On macOS that attaches it to the parent,
so it moves with it. On Windows it makes the widget always sit above the
main window and hide when the main window is minimized. Both get in the
way of a layout spread over two monitors.

### 2.3 Closing and quitting

Closing a widget closes it. Closing the main window ends the session: if
there are unsaved changes the app asks to save them, then quits and every
widget closes with it. Quitting from the menu or with Cmd-Q goes through
the same question. On macOS, clicking the app in the Dock with no window
open shows the main window again.

### 2.4 Layouts

The project saves which widgets are open, the columns each one shows,
and the size and position of each window. Opening the project restores
them. Positions are checked against the monitors present, which may not
be the ones the project was saved with. Windows are created hidden, given
their size and position, and then shown, so they do not flash in the wrong place.
Under Wayland on Linux an app can neither set nor read the position of
its windows (section 9), so there the layout restores the widgets and
their sizes but not their positions. Outside the project the app keeps
only the list of recent projects and the size and position of the main
window.

## 3. Where the shared state lives

Every Tauri window is a separate web view with its own JavaScript, and
nothing in one is visible to another. The backend is the Rust side of the
app, the one process all windows talk to, and it holds every piece of
state that more than one window needs. A window only displays the state
and asks the backend to change it.

The state is in three tiers:

- **The document**: the table, with its columns, their types, the
  populations and their colours. It is saved in the project and every
  edit to it can be undone.
- **The interaction**: the active classification, the selected
  population, the selection and the hover. It is shared by every window
  and lives in the backend, but is not undone. The active classification
  is also saved in the project, so that it opens the way it was left.
- **The window's own**: the camera of a 3D view, a lasso outline being
  drawn, the scroll position of the table. It stays in its window and the
  backend never sees it.

Every change to the document or the interaction is a command, a call from
a window to the backend, such as "assign these rows to population A",
"set the selection to these rows" or "add a column". The backend checks
it, applies it, increases a revision number and sends the change to every
window. It refuses a command it cannot apply, with a reason the window
shows. The window that sent a command does not change its own display
first. It waits for the change to come back from the backend, like every
other window. This costs one round trip to the backend, which has not
been measured (section 11), and in exchange no two windows can show
different states.

The backend keeps the undo history. Every command on the document records
the command that reverses it. It also keeps the flag that says whether
the project has unsaved changes. The flag drives the edited mark in the
title of the main window and the question on quit.

What a window computes from the state, such as the colour and size of
each point from the populations and the selection, is computed in each
window by one TypeScript function shared by all of them. The state has
one place and the computation has one implementation.

All of this lives in a Rust core that does not depend on Tauri: a
session, which holds the state, and a dispatcher, which applies commands
to it. The Tauri commands are thin wrappers around the dispatcher. This
is what lets the tests of section 10 run the real backend without Tauri.

Making the main window's JavaScript the owner of the state was
considered and not taken. Reloading or closing that window would lose
the state, and the other windows would still need messages to reach it.

## 4. How the data reaches each window

Two Tauri mechanisms are used:

- **A command that returns raw bytes.** A Tauri command can return
  `tauri::ipc::Response`, which the window receives as an `ArrayBuffer`,
  with no conversion to JSON.
- **A channel.** A Tauri `Channel` is a stream of messages from the
  backend to one window, delivered in the order they were sent. Tauri's
  documentation recommends channels for fast, ordered data.

Tauri's events, the other way to send from the backend to the windows,
are not used. Their payloads are always JSON, and Tauri's documentation
says the event system "is not designed for low latency or high
throughput".

The columns, the bulk of the data, are pulled by each window, only those
it shows. A small command first returns the description of the table as
JSON: the number of rows, and each column's id, name and type. Then each
column comes as raw bytes, for example a numeric column as 32-bit floats.
Three numeric columns of 50,000 rows are 600 kB.

The changes are pushed. Each window, when it starts, calls a subscribe
command and passes it a channel. The command returns a snapshot of the
state at some revision r, and from then on the channel carries every
change after r, each with its revision. Registering the channel and taking
the snapshot happen as one step in the backend, so a window that opens
while the user is editing cannot miss a change or apply one twice. The
same subscribe is how a window recovers after it is reloaded, which the
web view may do on its own (section 9).

Every column has a revision of its own, and a message about a column
carries it, so a window fetches again only the columns that changed.
The messages are binary and carry whole values, not differences:

| message | size for 50,000 individuals |
|---|---|
| the codes of a classification, 16 bits each | 100 kB |
| the selection, one bit per individual | 6 kB |
| the hover, one index | 4 bytes |

Sending only differences is left until a measurement shows whole values
are too slow. The window under the pointer sends at most one hover per
frame it draws. The backend drops a hover it has not yet sent when a
newer one arrives, so a slow window never falls behind. How long a hover
takes to appear in the other windows has not been measured (section 11).

## 5. The table

The table is held in the backend as a list of columns. Each column has:

- an id, fixed when the column is created, which never changes. Widgets
  and messages refer to a column by its id, so renaming a column breaks
  nothing.
- a name, which the user sees and can change. Names are unique within a
  table. An imported file with two columns of the same name is refused,
  and the message names the repeated names and the columns where they
  are, for example "the name 'height' is used by columns 4 and 9".
- a type, and the values, with missing values marked separately from the
  values themselves.

The first column names the individuals, whatever its header says. Its
values are text as written, so `001` stays `001`. Every row has a name,
and no name is in two rows. An imported file with a row whose first cell
is empty, or with a name in two rows, is refused, and the message names
the line and the name. The first column's type cannot be changed.

The types are numeric, integer, text, boolean and categorical. A
categorical column holds, for each row, a code that points into an
ordered list of levels, the names of the categories, plus a missing
value of its own. Its levels can include ones that no row uses yet,
which is how a new, empty population exists. A classification is a
categorical column with a colour for each level.

The colours come from a fixed list. When a categorical column is created,
by import or by a change of type, its levels are given the colours of the
list in the alphabetical order of their names. From then on each level
keeps its colour: a population added later takes the first colour of the
list no other level of the column uses, and renaming a population does
not change its colour. A column with more levels than the list has
colours goes through the list again in a different shade, lighter or
darker, so that no two levels share a colour. The user can change any colour with a colour
picker. Colours are part of the document, saved in the project and
undone like any other edit.

## 6. Column types

The type of each column is guessed on import (section 7), and the guess
will sometimes be wrong. Numeric codes of populations such as 1, 2 and 3
are a common case, and so is a classification of 20 populations or more,
which the guess takes for text (`table_io-needs.md`, section 3). The
dropdown on top of each column but the first lets the user change the
type.

The dropdown offers every type, but enables only the conversions that
lose no value for this column:

- to text or to categorical, from any type, always;
- from integer to numeric, always;
- to numeric, integer or boolean from any other type, only when every
  value of the column converts.

A conversion that would lose values is shown disabled with the reason,
for example "12 values are not numbers, such as 'n.d.' in row 40", rather
than turning those values into missing ones without saying so. A change
of type is a command and can be undone.

## 7. table_io

Reading a CSV and guessing the types of its columns are needed by Vavilov
Explorer and by popnei_web, the web applications of popnei, and the
guess must be the same for both. The owner's library `xlsx_rs`, which
today reads the first visible sheet of an xlsx file into cells and is
released as a WebAssembly package for popnei_web, becomes `table_io`, a
library of table reading and writing for both apps:

- reading CSV and TSV: finding the delimiter, semicolon-separated files
  with decimal commas as Spanish Excel writes them, and files in
  Windows-1252, the encoding Excel on Windows uses;
- reading xlsx, as `xlsx_rs` does now;
- one module that turns the cells of either format into typed columns:
  which texts mean missing ("NA", "-", an empty cell), and which columns
  are numbers, integers, booleans or categories. Being one module is what
  makes a table give the same columns from either format. A date is read
  as text, as `xlsx_rs` writes it, `2024-05-13`; a date type is added when
  a view needs one;
- writing CSV and xlsx, for export.

Each format is a cargo feature, so that popnei_web can still build a
WebAssembly package without xlsx, whose reader is almost all of the
package's size. The module that guesses the types is not behind a
feature. Vavilov Explorer uses the library crate natively, with every
feature, and not the WebAssembly package. popnei_web installs the
`xlsx_rs` package from a GitHub release by its URL, so the first
`table_io` release is published under the new name and popnei_web
changes its URL in the same step. What Vavilov Explorer needs of
`table_io`, in detail, is in `table_io-needs.md`.

Polars was considered for the table and not taken. Its Rust version does
not read xlsx, so an Excel reader is needed anyway, and type guessing of
our own would then still be needed to make both formats agree. At tens of
thousands of rows the counts and histograms the views need are simple
loops over our own columns. Polars would also lengthen the builds, enlarge
the app, and its Rust API changes between releases.

## 8. The project file

A `.vav` file is a zip archive, as an xlsx is, with two files in it:

- `table.parquet`: the data. Parquet is a standard binary format for
  tables that stores each column's type, its missing values and exact
  floats, and that R, pandas and polars read. A categorical column is
  stored as text, so a reader in another program sees the names of the
  populations, not their codes. CSV was considered and not taken: it has
  no types, and in CSV a text value "NA" and a missing value cannot be
  told apart without an escaping of our own.
- `project.json`: what Parquet cannot hold, which is a version of the
  format, each column's id, which text columns are categorical, with the
  order of their levels and their colours, the active classification,
  the layout of the windows (section 2.4), and the decimal mark of the
  import, by which a later change of type reads the values.

No fact is stored in both files. The types Parquet can hold, numeric,
integer, text and boolean, are read from Parquet, and `project.json`
does not repeat them.

Saving writes a new file next to the old one and then renames it over
the old one, so a crash during a save leaves the previous project whole.
The version in `project.json` lets a later version of the app upgrade an
older project. A project written by a newer version of the app than the
one opening it is refused, with a message that says so. The undo history,
the selection and the hover are not saved.

Two alternatives were considered and not taken. A small project file
that points to the CSV or xlsx would break when the data file is moved or
renamed, would no longer match a data file edited in Excel, and would
leave the user with two files to keep together. Storing the project in
the user's xlsx would lose its other sheets, formulas and formatting,
which the writer cannot keep.

## 9. Platforms and their constraints

The app targets macOS and Windows, and Linux as well. Each uses a
different web view: WKWebView on macOS, WebView2, which is Chromium, on
Windows, and WebKitGTK on Linux. The design depends on these platform
facts, taken from the Tauri 2.12 documentation and source and from tao
0.37, the library Tauri uses for windows:

- **Throttled and unloaded windows.** A web view whose window is
  minimized or hidden is throttled, and after about five minutes it may be
  unloaded. Tauri can turn this off with `backgroundThrottling`, but only
  on macOS 14 and later. On Windows, Linux and older macOS it stays on.
  So every window must recover from a reload, by subscribing again
  (section 4). Where it can be turned off, every window turns it off.
- **Window positions under Wayland.** tao says setting a window's
  position under Wayland "has no effect, since Wayland doesn't support a
  global coordinate system", and reading it returns 0, 0. Hence the limit
  on layouts in section 2.4.
- **Creating windows.** Creating a window from a synchronous Tauri
  command deadlocks on Windows, so every command that opens a window is
  asynchronous.
- **Menus.** On macOS the menu bar belongs to the app; on Windows and
  Linux each window has its own. The menu is defined once in the backend
  and shown in the app's menu bar on macOS and in the main window only on
  Windows and Linux, since a menu bar in every widget would take space
  from the view.
  Keyboard shortcuts, such as Enter to apply a lasso and Esc to cancel
  it, are handled by one TypeScript module present in every window and
  turned into commands, so they do not depend on where the menu is.
- **Hover in an inactive window on macOS.** WebKit sends mouse movement
  only to the active window, so on macOS a widget shows a hover only once
  it is active: the user clicks a view before hovering in it. The hover
  still shows in every other window. The owner accepted this on
  2 October 2026. A workaround would watch the pointer with native macOS
  code and pass its position to the page; it was not tried. Windows and
  Linux have not been checked.
- **The first click in an inactive window.** On macOS the first click in
  a window that is not active only activates it, and the window never
  sees the click, unless the window sets `acceptFirstMouse`. On Windows
  and Linux the click always goes through. Tauri sets this for a whole
  window, not for each gesture. The point views, the 3D scatter and the
  map, set it, so that a lasso, a rotation or a pan starts on the first
  press, as on the other platforms. The histograms, the bar plots and the
  main window do not, because there a single click changes the shared
  selection, which cannot be undone, and a click meant only to bring the
  window forward would replace it.
- **Fullscreen on macOS.** A window in fullscreen moves to a Space of its
  own, a separate desktop, and the other windows of the app are no longer
  visible beside it, which defeats views meant to be seen together. So
  the widgets cannot go fullscreen; they can be maximized to fill their
  screen.
- **Opening a `.vav` from the file manager.** On macOS a running app
  receives the file as an event, `RunEvent::Opened`. On Windows and Linux
  the file arrives as an argument of a new process, and Tauri's
  single-instance plugin passes it to the instance already running, so
  that there is still only one project open.
- **Permissions by window.** A Tauri capability, the list of what a
  window may call, names windows by their label, so the widgets get
  labels such as `scatter3d-1` and one capability covers them all with a
  pattern.

Each window is a separate web view, with its own process and its own
WebGL context, so memory grows with every window open. It has not been
measured.

## 10. Testing

There are three layers, from the most tests to the fewest.

1. **The Rust core**, with `cargo test`: the commands and their refusals,
   the revisions, the atomic subscribe, the dropped hovers, undo, the
   checks of a layout against the monitors, the guessing of types, and
   the project file written and read back.
2. **The windows, in WebKit and in Chromium, against the real core.**
   Playwright runs each window as a page of one browser, the real
   frontend in each. The harness, `e2e/harness.mjs`, replaces only
   Tauri's IPC, the calls from a window to the backend and the channel
   messages back. It forwards them to a small test-only Rust program that
   runs the same dispatcher, so the backend logic in these tests is the
   real one. The core opens and closes windows through an interface of its
   own, a Rust trait, which the app implements with Tauri windows and the
   test program by asking the harness to open and close pages. WebKit stands for
   macOS and Linux, Chromium for WebView2 on Windows. The tests include a
   selection made in one page and seen in the others, with the pixels
   checked as in the prototype; a window opened late and a window
   reloaded, each showing the current state; and the order of messages
   under rapid changes. Tauri's own mocks, `mockIPC`, were considered and
   not taken: they replace the backend rather than the transport, and
   their event mocking does not support sending to one window.
3. **The real app**, a few smoke tests driven through WebDriver, the
   standard protocol for driving a browser from a test. On Windows and
   Linux this is `tauri-driver`. On macOS, which has no WebDriver for
   WKWebView, it is the Tauri service of WebdriverIO, a test framework in
   JavaScript, with
   `tauri-plugin-wdio-webdriver`, a plugin that runs a WebDriver server
   inside the app and is built into debug builds only. The same plugin
   also works on Windows and Linux. These tests cover what the harness
   cannot: the real IPC, real windows, throttling and quitting. Whether
   the plugin handles several windows on macOS has not been checked.

## 11. Open decisions

One decision is open:

- A compact key of the populations, with a line saying which population
  is being edited, in each plot window. Deferred by the owner until the
  first views exist.

The builds are tried on the owner's machines: the Mac, a Windows
machine, and a Linux virtual machine with both a Wayland and an X11
session. A virtual machine usually draws WebGL without the GPU, so on
Linux the experiment checks behaviour, and its times are not taken as
those of a real machine.

The experiment below was run on macOS on 2 October 2026, in
`spikes/windowing/`, whose README has the numbers. A change made in one
window reached another in 1 to 3 ms at the median and 13 ms at most, so
it is drawn on the other window's next frame, as it would be within one
window. Messages arrived as `ArrayBuffer`s and in order, a minimized
window received every message, WebDriver drove the three windows, and a
window that is not active received no pointer movement (section 9). It
still has to be run on Windows and Linux.

Before the real code, a throwaway experiment should answer what the
design assumes and has not measured. The proposed bar for the hover is
that it appears in the other windows within one frame of a 60 Hz screen,
17 ms. On each of the three platforms:

- the backend and two windows, with a selection and a hover sent through
  channels;
- how long a hover takes to appear in the other window with 50,000
  points;
- whether a window that is not active receives the pointer's movement,
  so that hovering there works;
- whether raw bytes pass through a channel as an `ArrayBuffer`;
- whether the WebDriver plugin can drive several windows.
