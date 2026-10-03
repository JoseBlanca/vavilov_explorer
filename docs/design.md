# The design of Vavilov Explorer

2 October 2026, before any code. This document records the design the
owner agreed that day for the first version of Vavilov Explorer. It
covers what the user works with, the windows, where the shared state lives
and how it reaches each window, the table and the project file, what
the frontend is built with, the platforms, and how all of it is tested. Decisions still open are in
section 12. What an earlier prototype taught, about rendering, the map
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
- **Classification**: a column of the table with the role of a category
  (section 6), seen as the populations it divides the individuals into.
  Any category can be one: country of origin, a genetic clustering, or
  a trait such as the colour of the flower; which the user edits is
  their decision.
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

The user edits the cells of the active classification with a lasso in a
plot, and any cell in the table (section 2.1). The other edits are to
the shape of the table: adding and removing columns, renaming them,
adding, renaming and removing populations, and changing the type of a
column. Every edit can be undone. An earlier version of this design let
the user edit only the active classification, so that a trait would not
be changed by mistake; the owner opened every column to editing on
2 October 2026, with undo and the double-click of section 2.1 as the
guard.

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
- A missing value is shown as an empty cell, which a screen reader
  announces as "missing". A number is shown in the shortest form that
  gives back the same value, with the decimal mark of the system's
  region, as Excel shows it, and never rounded: `1.50` in the file is
  shown as `1.5`, or `1,5` with a Spanish region. The core keeps the
  number and not the text the file had, so showing the file's own text
  would need a second copy of every numeric cell. Both decided by the
  owner on 2 October 2026; the region in place of the language, decided
  the same day (section 7). The mark is read when the window starts.
- On top of each column, a dropdown shows its type and lets the user
  change it (section 6).
- A cell is edited by double-clicking it, or by pressing Enter on it, so
  that a single click still selects its row and typing alone changes
  nothing. Beside the cell being edited, a checkbox, "Apply to all
  selected rows", off by default, applies the value to every selected
  row instead; it gives no count, to keep the widget small. A value must
  fit the column's storage type, which never changes (section 6), the
  same for one cell or many; a value that does not fit is refused and
  the cell keeps its value. IndividualID is edited one cell at a time,
  since one ID given to several rows would repeat it. An edit of many
  rows is one command: it changes every row or none, and one undo
  reverts it. Decided by the owner on 2 October 2026. Built so, and
  confirmed or decided by the owner on 3 October 2026:

  - Enter applies the value, and so does leaving the cell for another
    place, so that the user need not press Enter each time; Escape gives
    the cell back as it was. Enter moves on to the cell below, as in a
    spreadsheet.
  - The keyboard moves on the cells as in a spreadsheet: the table is a
    stop of Tab, the arrows move a cell, Home and End to the first and
    last column, Page Up and Page Down a screenful, and Enter opens the
    cell for editing; Space selects its row, and Shift-Space the rows
    from the last one selected; Shift with ↑, ↓, Page Up or Page Down
    extends the selection from the row where the run of such keys
    started (decided by the owner on 3 October 2026). The cell is drawn
    with the focus ring, and a screen reader is told it as the grid's
    active cell. Space and Shift-Space were added by the assistant, to
    select by the keyboard as a click does.
  - The checkbox is offered only when the cell's row is one of several
    selected, and sits beside the cell, at its right, or at its left in
    the last column, where the list of suggestions below the field does
    not cover it (decided by the owner on 3 October 2026). A value
    refused is an error in the information bar, such as "“1,5” was not
    put in “seeds”, which holds whole numbers, such as 12. Type a whole
    number, or nothing for a missing value."
  - A category suggests its values as the user types; the list closes
    once the one value that fits is the text typed (decided by the
    owner on 3 October 2026). A name that is none of them is refused: a
    new population is made another way, not by typing it in a cell.
  - A click on a row of a selection of several waits 500 ms, Windows'
    default double-click time, before it selects that row alone: the
    first click of a double-click would otherwise leave that row the only
    one selected, and "Apply to all selected rows" could not be used
    with the mouse.
- Above the table, a find bar: a field for the text searched, a Column
  dropdown, "Any column" first and then every column from IndividualID
  on, a checkbox "Whole cell", off by default, and a checkbox "Show rows
  that don't match". Typing shows only the rows that match, and an empty
  field shows them all. A cell matches by the text the table shows,
  case ignored and accents not; a cell of a country matches when the
  text is part of any of its ISO names or equals one of its codes; a
  missing cell never matches. The filter hides rows of the table only,
  not of the other windows, and the backend holds it and finds the
  rows. The filter by the selection or by one population planned here
  before is left out: a population is a search of its column, whole
  cell. Decided by the owner on 2 October 2026. A button "Select shown
  rows" makes the rows the table shows the selection, in place of the
  one there was (decided by the owner the same day). It sits in the
  find bar, after the checkboxes, and with an empty field it selects
  every row (confirmed by the owner on 3 October 2026).
- Below the table, an information bar, the one place for information,
  warnings and errors about the table: the count of the rows shown,
  "Showing 312 of 2,000 individuals", and above it the messages, each
  with its kind in words, "Error:", "Warning:" or "Information:". The
  refusals of an import and an export are errors there, and a
  character an import could not read is a warning. A defect of the app
  keeps its red bar across the top of the window (section 12), and a
  question that needs an answer before anything happens, such as "Make
  “origin” text?" (section 6), keeps its dialog. Decided by the owner
  on 2 October 2026.

  The bar shows one message at a time. Decided by the owner on
  2 and 3 October 2026:

  - An error stays until the user closes it with ×. A warning stays 5
    seconds, with no ×. An informational message has no ×, and stays
    until another message takes its place.
  - Errors and warnings wait in a queue, in the order they came, and the
    next shows when the one shown goes. An informational message never
    waits: it takes the place of nothing or of another informational
    message at once, and while an error or a warning is shown it is
    dropped.

  The rest was proposed by the assistant on 2 October 2026 and built so:

  - While messages wait, the one shown ends with "(2 more)".
  - A message with the same words as one shown or waiting is not added
    again, so three refused exports show one error.
  - A successful import empties the bar and its queue: their messages
    were about the table or the file before it.
  - The count is not a message: it stays on its own line, always
    there.
  - The bar is there with no table loaded too, below the title of the
    empty window, so that a refused first import is told.
  - For a user of the keyboard: closing an error with × moves the
    keyboard's place to the × of the next error, or, when none follows,
    back to the control it was on before the first error appeared.
  - For a screen reader, which reads the window aloud to a user who
    cannot see it: an error is read out at once, and a warning or an
    informational message at the next pause.

  Nothing makes an informational message yet.
- Undo and Redo are in an Edit menu, with Cmd-Z and Cmd-Shift-Z, Ctrl-Z
  and Ctrl-Shift-Z on Windows and Linux (decided by the owner on
  2 October 2026). They are greyed out when there is nothing to undo or
  redo. In a field to type in, the find bar's or a cell's, they undo
  and redo the typing in the field, not the last edit of the table: the
  page sees the key before the menu and takes it, and a click on Edit >
  Undo reaches the main window as an action, which undoes the field's
  typing when a field has the focus (section 10).
- The populations panel lists the populations of the active
  classification, each with its colour, name and number of individuals. A
  dropdown above it chooses the active classification. It is where a
  population is selected and edited. It sits left of the table, as a
  sidebar. Its last row is the unassigned individuals, with their number,
  and it can be selected like any population: then + makes every
  individual inside a lasso unassigned, whatever population it was in,
  and − is shown disabled, with the reason "Unassigned individuals are in
  no population to remove them from". Its first version chooses
  the active classification, shows the populations, selects one and sets
  the pointer's mode; adding, renaming and removing populations and
  changing a colour come after, each with its command in the core.
  Decided by the owner on 2 October 2026. Having seen the panel the
  same day, the owner decided that the control of the pointer's mode
  belongs in the windows where a lasso makes sense, the plots, and not
  in the panel; it stays in the panel until the first plot exists.
  Whether the mode is one for all windows or one per window is decided
  then; until then it is the main window's own.
- With no project open, the main window shows an empty state: Open
  project…, Import table…, the recent projects, and dropping a file on
  the window, which opens a `.vav` and imports a CSV, TSV or xlsx. An
  import that fails says why, where in the file and what was found, for
  example "line 1,203: 14 fields, expected 12", and loads nothing. A
  separate launcher window was considered and not taken: it would be one
  more window to open and close, and the window would jump in size when
  the data arrived. Until the project file exists, the import and the
  export start from the File menu alone, Import table…, Export as CSV…
  and Export as Excel…, with no keyboard shortcut, and the empty state
  shows the title; an import replaces the table there is without
  asking, since there is no project to save yet (decided by the owner on
  2 October 2026).
- The Open and Save dialogs of an import and an export are the system's,
  opened by the backend, so that no window sends the backend the path of
  a file (decided by the owner on 2 October 2026). The dialog of Import
  table… shows only `.csv`, `.tsv`, `.txt` and `.xlsx` files, and that
  of Open project… only `.vav` files (decided the same day).
- An import that is refused says what happened and how to put it right,
  in the names of the user's file, as an error in the information bar.
  An import that read a character it could not decode says so as a
  warning there, which names its line. Choosing the separator, the decimal mark
  or the encoding by hand, and importing again, comes later. Decided by
  the owner on 2 October 2026.

### 2.2 Widgets

A widget is a window with one view of some columns:

| widget | columns |
|---|---|
| 3D scatter | three numeric columns |
| histogram | one numeric column |
| bar plot | one category |
| map | a latitude and a longitude column |

The same kind of widget can be open more than once, for example two
scatters of different principal components. A widget is created from a
Plot menu, which opens a small dialog to choose the columns, filled in
from the columns selected in the table. The dialog offers every column
whose role fits, so that a table with two latitude columns, `lat` and
`Latitude`, offers both to the map (decided by the owner on 2 October
2026). It can also be created by
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
its windows (section 10), so there the layout restores the widgets and
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
shows. The one exception is a command made just before another project
was opened, which names the old table: it is refused, and the window
writes the refusal to the app's log and shows nothing, since the user
already sees the project they opened (decided by the owner on 2 October
2026, `core.md`, section 4). The window that sent a command does not change its own display
first. It waits for the change to come back from the backend, like every
other window. This costs one round trip to the backend, 1 to 3 ms at the
median on macOS (section 12), and in exchange no two windows can show
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
is what lets the tests of section 11 run the real backend without Tauri.

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
web view may do on its own (section 10).

Every column has a revision of its own, and a message about a column
carries it, so a window fetches again only the columns that changed.
The messages are binary and carry whole values, not differences:

| message | size for 50,000 individuals |
|---|---|
| the codes of a category, 16 bits each | 100 kB |
| the selection, one bit per individual | 6 kB |
| the hover, one index | 4 bytes |

Sending only differences is left until a measurement shows whole values
are too slow. The window under the pointer sends at most one hover per
frame it draws. The backend keeps no queue of hovers: a hover replaces
the last one and is handed to every window at once, which Tauri does
within the call (`core.md`, section 5). If hovers are seen to lag on
Windows or Linux, a queue per window that keeps only the newest is added
to the app, so that a slow window never falls behind; the owner decided
on 2 October 2026 to wait for that measurement. So that hovers can be
dropped without breaking the sequence of revisions, the hover takes no
revision: it carries a sequence number of its own, and a window keeps
the hover with the highest number it has seen. On macOS a hover
reached another window in 1 to 3 ms at the median and was drawn on its
next frame (section 12).

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

The first column names the individuals, and its header must be
`IndividualID`, compared with case, spaces and underscores ignored, so
that `Individual ID`, `individual_id` and `INDIVIDUALID` are accepted
(decided by the owner on 2 October 2026). A file whose first column has
another header is refused, and the message says what the header is and
what it must be: "accessions.csv could not be imported: its first
column, which must hold the ID of each individual, is named 'accession'.
Name it IndividualID and import the file again." Requiring the name
makes a file whose IDs are not in the first column fail with that
reason, rather than with one about repeated names. The app shows the
column as `IndividualID`, and an export writes that header, so that a
file Vavilov Explorer wrote imports again unchanged. Its
values are text as written, so `001` stays `001`. Every row has a name,
and no name is in two rows. An imported file with a row whose first cell
is empty, or with a name in two rows, is refused, and the message names
the line and the name. The first column's type cannot be changed.

Each column but the first has a storage type and a role (section 6).
A column whose role is a category holds, for each
row, a code that points into an ordered list of levels, the values of the
categories, plus a missing value of its own. Its levels can include ones
that no row uses yet, which is how a new, empty population exists. Each
level has a colour.

The levels are ordered when they are built, by the import or by a
change of role: text in the order of the names below, numbers as
numbers, and FALSE before TRUE. The colours come from a fixed list, given
to the levels in that order. From then on each level
keeps its colour: a population added later takes the first colour of the
list no other level of the column uses, and renaming a population does
not change its colour. The list has 21 colours (below); a column of more
levels starts the list again, so that two levels share a colour, which
the owner accepted on 2 October 2026 until there are more populations
and more views to judge it by. The order of text is
with case ignored, ties broken by the exact text, and numbers inside a
name are compared as text, not as numbers. The list is Okabe and Ito's
without its black, seven colours from orange, then the same mixed with
40 % white, then with 40 % black (decided by the owner on 2 October 2026,
`core.md`, section 10). The user can change any colour with a colour
picker. Colours are part of the document, saved in the project and
undone like any other edit.

## 6. Storage types and roles

Every column but the first has two types, decided by the owner on
2 October 2026:

- **The storage type** is what its values are: whole numbers, decimal
  numbers, yes or no, or text. It is what the import read from the file
  (section 7), and it is never changed: a column of text that would be
  numbers but for a value such as `n.d.` is corrected in the file and
  imported again, since a conversion would turn `n.d.` into a missing
  value without saying so, and a column whose every value is a number is
  read as numbers in the first place.
- **The role** is what the column is for, and is what the user chooses,
  in a dropdown on top of each column but the first:
  - **number**: drawn on an axis, in a histogram, or as coordinates on
    the map;
  - **category**: values that divide the individuals into groups, a
    trait such as the colour of the flower or populations such as a
    genetic clustering; drawn in a bar plot, and any category can be the
    active classification, which a lasso edits;
  - **text**: notes and identifiers, shown in the table alone.

  Category and classification were two roles until the owner merged them
  on 2 October 2026: the user chooses which category to edit, and a role
  that kept measured traits out of the lasso's reach was a guard the
  owner judged not worth its cost. What the merge gives up, and the owner
  accepted: a lasso can change a trait the user recorded, a change that
  outlives the session once the project is saved; a trait's missing
  values are its "unassigned" individuals; the panel lists every
  category. The guard that remains to be decided is separating the
  column that colours the views from the one being edited
  (section 12).

Which roles each storage type can take:

| storage type | number, latitude, longitude | category, country | text |
|---|---|---|---|
| whole numbers | yes | yes, not country | no |
| decimal numbers | yes | yes, not country | no |
| yes or no | no | yes, not country | no |
| text | no | yes, and country | yes |

Three roles are sub-roles of others, decided by the owner on 2 October
2026: they behave as the role above them, and add a check of every value
and what the views can do with it.

- **latitude** and **longitude**, sub-roles of number, offered only when
  every value is from −90 to 90, and from −180 to 180, missing values
  allowed. A latitude is still a number for a histogram or an axis; the
  map takes its columns from them. Coordinates in metres, a longitude
  from 0 to 360, or degrees written as text such as `40°25'N` can be
  numbers but not these.
- **country**, a sub-role of category, for text,
  offered only when every value names a country of ISO 3166-1, or a
  former one of ISO 3166-3: by its two- or three-letter code, or by its
  ISO name or official name in English; case and surrounding spaces are
  ignored, accents are not. The shorter names of Natural Earth, the data
  behind the map's borders, such as `Bolivia` or `South Korea`, are not
  accepted, nor a territory by the country it belongs to, as the owner
  decided on 2 October 2026: for now, only ISO's codes and names. A two- or three-letter code that ISO gave to a current country
  after a former one means the current country (`AI` is Anguilla, not the
  French Territory of the Afars and the Issas); a former country is then
  named by its name, its four-letter code (`SUHH`), or a three-letter code
  no current country uses (`SUN`). Each value is shown as its country's
  three-letter code, whatever the file wrote, so that `ES` and `Spain`
  are one level, `ESP`; a former country whose three-letter code a
  current one uses is shown by its four-letter code. A new population of
  a country category being edited must be a country.

The dropdown offers, of number, latitude, longitude, category, country
and text, only those the column can take: by its storage type, a
category only when its distinct values fit the 65,535 codes of a column,
and a sub-role only when every value passes its check. A role it
cannot take is not shown, as the owner decided on 2 October 2026. A
column with no value, all missing or in a table of no row, passes every
check, and is offered latitude and longitude, or country, too (decided
by the owner the same day).

A change of role never changes a value, but for country, which writes
each value as its code, and for −0: it builds or drops the list of
levels, and a category of decimal numbers holds −0 and 0 as one level,
so that a column of numbers made a category and then a number again
gives 0 where it had −0. The app shows both as 0; the owner accepted it
on 2 October 2026. The
levels of a category keep the storage type, so that population codes 1,
2 and 10 are ordered as numbers, and an export writes them back as
numbers. A change of role is a command and can be undone, and undoing a
change to country gives back the file's spellings. Any category, of
countries or not, can be the active classification; one whose role is
changed to a number or text stops being active, and one whose levels are
built again, between category and country, loses its selected
population. A change that would stop the active classification asks
first, since one key pressed on the dropdown is enough to make it, and
the interaction is not undone: "Make “origin” text?", with what follows
from it and how to choose the column again, and the buttons "Keep it a
category" and "Make it text";
Escape keeps it (decided by the owner on 2 October 2026).

The list of countries is a table in the core, generated once from the
data of Debian's `iso-codes` (ISO 3166-1 and 3166-3, their codes, names
and official names), and committed with its source, its date and the
SHA-256 of what was read; it is generated again when ISO changes a
country. A name a current and a former country would share goes to the
current one, as the owner decided on 2 October 2026; one that two
current or two former countries would share is left out.

The import guesses the role: number for whole and decimal numbers,
latitude or longitude for a column of numbers whose header is `lat` or
`latitude`, or `lon`, `long` or `longitude`, case ignored, and whose
values fit; category for yes or no and for text of 1 to 20 distinct
values, and text for the rest. A column with no value is text, whatever
its header: a category of no levels would be offered as a classification
with every individual unassigned (decided by the owner on 2 October
2026). After an import the first category, of countries or not, is the
active classification, so that its populations show at once, and none is
when the table has no category (decided the same day).

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

Vavilov Explorer takes `table_io` by git at the revision of its release
`js-v0.2.0-dev.1`, c99b3e6, and imports a file of at most 20 MB and an
xlsx of at most 2,000,000 cells, popnei_web's limits (decided by the
owner on 2 October 2026). The export of a CSV asks for the separator,
the decimal mark, the encoding (UTF-8, UTF-8 with the mark Excel writes,
or Windows-1252) and the text of a missing value (empty or `NA`), and
starts from `;` and a decimal comma when the system's region writes
numbers with a comma, from `,` and a point otherwise, from UTF-8 with
the mark, and from an empty missing value; the export of an xlsx asks
nothing. The region is read by the backend from the operating system,
because Excel takes its decimal mark from the region and the web view
from the language: on macOS with English as the language and Spain as
the region, the web view writes 1.5 and Excel 1,5 (measured on 2 October
2026; decided by the owner the same day). With the comma as the
separator, the point is the only decimal mark offered: `table_io` would
write each decimal number in quotes, `"1,5"`, which the import reads
back as text, and a column's storage type never changes (decided by the
owner on 2 October 2026). The default file name of an export is
`table.csv` or `table.xlsx` (decided the same day). An export that is
refused names the column and the row (decided by the owner on 2 October
2026), as an error in the information bar (section 2.1).

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
  floats, and that R, pandas and polars read. A category or a
  classification is stored in its storage type, so a reader in another
  program sees the values of the populations, not their codes. CSV was considered and not taken: it has
  no types, and in CSV a text value "NA" and a missing value cannot be
  told apart without an escaping of our own.
- `project.json`: what Parquet cannot hold, which is a version of the
  format, each column's id, the role of each column, and for a category or a
  classification the order of its levels and their colours, the active
  classification, and the layout of the windows (section 2.4).

No fact is stored in both files. The storage types are read from
Parquet, and `project.json` does not repeat them.

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

## 9. The frontend

Every window runs TypeScript, with strict type checking, on the plain DOM
and CSS, with lit-html for the parts drawn as HTML, D3 for the 2D plots
and Three.js for the point views.

What each part of the interface is drawn with:

- **The 3D scatter and the map**: Three.js on a canvas, as in the
  prototype (`prototype-lessons.md`). A hover or a selection writes
  straight into the buffers of the points that the GPU draws.
- **The histograms and the bar plots**: D3, the most widely used library
  of data visualization on the web, drawing SVG. D3 gives the parts of a
  plot rather than finished charts, and these modules are used:
  `d3-array` to bin the values of a histogram, `d3-scale` and `d3-axis`
  for the scales and the axes, `d3-selection` to create and update the
  bars, and `d3-brush` for dragging across bins to select them. A plot
  has a few dozen bars, whatever the number of individuals, and a new
  selection changes only the height of the selected share of each bar.
  D3 owns the SVG of its plot, and lit-html never renders inside it, so
  that no element is changed by both. D3 is not used for the point
  views: 50,000 points in SVG would be slow, and Plotly, tried in the
  prototype, sent every point again on each edit (`prototype-lessons.md`).
- **The table**: rows of a fixed height, of which only those on screen
  are in the DOM, written for the app.
- **Everything else drawn as HTML**: the populations panel, the
  dropdowns of the column types, the dialogs, the empty state, the
  messages. These are rendered with lit-html, a library of about 3 kB
  (version 3.3) that updates the DOM from a template and does nothing
  else. A view is a function from the state to a template, and its
  controller calls it whenever the state changes, so a list whose
  populations are added, renamed or removed cannot be left with stale
  rows, listeners or focus.

Native HTML elements are used where they exist: `<select>` for the types
and for the active classification, `<dialog>` for the dialogs, and
`<input type="color">` for the colour of a population, which opens the
system's colour picker. They bring the keyboard handling and the
accessibility that would otherwise come from a library of components.

In each window, the state is the window's copy of the backend's state
(section 3), plus the window's own, such as the camera of a 3D view, held
by the window's controller. Nothing else in the window holds state.

React was considered and not taken. Its components hold state of their
own, `useState` and effects, and syncing them with the window's copy of
the backend's state would put the state in two places. Its strengths are
that it is the framework language models know best and that its
ecosystem of components is the largest. They would matter if the
interface grew into many complex forms. Since every view here is a
function of the state, moving them to another library later would touch
the views and not the controllers.

The tools:

- Vite builds the frontend, Vitest runs the unit tests and Playwright
  the end-to-end tests (section 11).
- ESLint with typescript-eslint, in its strict configuration. Its rule
  `no-floating-promises` makes a promise whose failure nobody handles,
  such as an unawaited call to the backend, an error, so a failed command
  cannot pass silently. The windowing spike wrote such calls as
  `void invoke(...)`, which hides a failure.
- Prettier formats the code.

## 10. Platforms and their constraints

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
- **Undo in a text field.** On macOS, while Undo or Redo is greyed out
  in the menu, because there is nothing to undo in the table, as right
  after a load, the menu keeps Cmd-Z from the find bar's field and the
  web view does not undo the field's typing either; the reviewer showed
  it with a test of the real app. So the window handles Cmd-Z and
  Cmd-Shift-Z itself in a text field, Ctrl-Z, Ctrl-Shift-Z and on Windows
  Ctrl-Y elsewhere, and takes the key from the menu
  (`src/windows/shared/fieldUndo.ts`). How much one Undo takes back
  differs: WebKit takes back the word typed, while Chromium, and so
  WebView2 on Windows, takes back one letter at a time, because the table
  draws again between two keys. In the e2e harness, where the test types
  two characters at once, both took back the two. Not checked yet:
  whether on Windows the menu's Ctrl-Z reaches the menu at all while the
  web view has the focus, since wry, the library under Tauri that holds
  the web view, does not listen to WebView2's `AcceleratorKeyPressed`; it
  is to be tried on the owner's Windows machine.
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

## 11. Testing

There are three layers, from the most tests to the fewest. The skills add
two narrower ones (`.claude/skills/coding/testing.md`): the Tauri
commands of the app tested with Tauri's mock runtime, which checks their
wiring with no web view, and the Vitest tests of the frontend's pure
functions.

1. **The Rust core**, with `cargo test`: the commands and their refusals,
   the revisions, the atomic subscribe, the hover's sequence number, undo, the
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

## 12. Open decisions

Open decisions:

- Whether the column that colours the views is the active
  classification, the one being edited, or a column of its own. The
  owner noted on 2 October 2026 that the selected population may be
  shown by size, and the colour may follow another column; separating
  the two is the guard against editing a trait by mistake that the
  merge of category and classification left (section 6).
- A compact key of the populations, with a line saying which population
  is being edited, in each plot window. Deferred by the owner until the
  first views exist.
- How a window tells the user that the backend refused a command, which
  today goes only to the console. The owner's direction, on 2 October
  2026: nothing that takes over the window the user is looking at and
  leaves them unsure what to do. A notice is acceptable when the user can
  dismiss it with a ×; a refusal that matters enough is a pop-up that
  says what happened; one that is only to be recorded goes to the app's
  log, which a window of its own could show. Built with the first plot
  window, when a second window makes refusals common.

Raised on 2 October 2026 while the skills of the project were written
(`.claude/skills/`), and decided by the owner the same day:

- A defect of the app, a bug of ours rather than a problem of the user's
  file, is shown as a red bar across the top of the window: "Vavilov
  Explorer hit an internal error. Your data has not been changed. Please
  save your work and report this.", with a button that copies the
  technical details for the report. The sentence about the data holds
  because the core applies each command whole or not at all.
- A lost WebGL context, a 3D view whose drawing the graphics card dropped
  after a reset, is shown as a short message over that view: "The 3D view
  was lost by the graphics card and is being restored.", which goes away
  once the view is drawn again.
- The population of one individual is changed from the table by typing
  the population's name in the cell of the active classification, with
  the names of its populations suggested as the user types. A name that
  is not yet a population is refused: a new population is made another
  way (decided by the owner on 3 October 2026, section 2.1).

- The oldest platforms supported: macOS 14, Windows 10 and 11, and Linux
  with WebKitGTK 2.44, such as Ubuntu 24.04. Their engines are about
  Safari 17, which sets the web features the code may use
  (`.claude/skills/coding/typescript.md`, "The engines").
- Tauri's isolation pattern is used, which Tauri recommends against a
  malicious frontend dependency; it is reconsidered only if it causes
  problems in real work. Measured afterwards with the windowing spike: the
  hover and a selection are as fast as without it, a payload of 100 kB
  takes 26 to 30 ms instead of 2 to 3, and a raw response of 600 kB about
  60 ms instead of 2 to 3 (`spikes/windowing/README.md`).
- Light and dark follow the system's appearance, and the app has a
  setting of its own, system, light or dark, so that a user can choose a
  mode for Vavilov Explorer other than the system's. The setting belongs
  to the app, not to a project, and every window follows it. Where it is
  set in the interface is decided when it is built.
- The colours of the populations start from Okabe and Ito's list, which
  people with the common kinds of colour blindness can tell apart.
- The fonts are the system's.
- Accessibility follows WCAG 2.2 at level AA, as popnei_web does.
- Two Rust dependencies are taken: `thiserror`, which writes the
  `Display` and `Error` code of the error enums, and `serde`, which
  serialises what crosses to a window, such as an error a command
  returns. Tauri depends on `serde` already, and both are maintained by
  David Tolnay. Approved by the owner on 2 October 2026. The same day
  the owner approved `serde_json` as a development dependency of the
  core, to test the shape of its errors as a window receives them; it
  too is in `Cargo.lock` already, through Tauri. And
  `tauri-plugin-dialog`, Tauri's plugin for the system's Open and Save
  dialogs, for Open project… and Import table…. And, to read the decimal
  mark of the system's region (section 7), one crate per platform, each
  in `Cargo.lock` already through Tauri: `objc2-foundation` on macOS,
  `windows` on Windows and `libc` on Linux, approved by the owner on
  2 October 2026.

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
window that is not active received no pointer movement (section 10). It
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
