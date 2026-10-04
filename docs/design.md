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
traits, principal components, the groups each individual is
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
  (section 6), seen as the groups it divides the individuals into.
  Any category can be one: country of origin, a genetic clustering, or
  a trait such as the colour of the flower; which the user edits is
  their decision.
- **Active classification**: the classification that colours every view.
  The user chooses it in the groups panel of the main window.
  Changing it recolours every window.
- **Group**: one value of the active classification.
- **Unassigned**: an individual whose value in the active classification
  is missing. It belongs to no group.
- **Selected groups**: none, one or several groups of the active
  classification, and its unassigned individuals or not, chosen in the
  groups panel; none selected is every individual. The groups selected
  stand out in every view, and the table greys out the rows of the
  others. With one selected, the user edits it: its row shows + and −,
  two buttons that stay pressed; while + is pressed, every individual
  selected goes into the group, and while − is pressed, every
  individual selected that is in it becomes unassigned. With several,
  only − is offered, and it acts on all of them (section 2.1).
- **Selection**: a set of individuals, made by a lasso in a plot, by
  rows in the table, or by bars of a histogram. It is shown in every
  window. The selection and the selected groups are different things
  and the interface keeps them apart.
- **Hover**: the one individual under the pointer, shown in every window.

The user edits the cells of the active classification with + and − in
the groups panel, which act on the individuals as they are
selected, in any window, and any cell in the table (section 2.1). The
other edits are to
the shape of the table: adding and removing columns, renaming them,
adding, renaming and removing groups, and changing the type of a
column. Every edit can be undone. An earlier version of this design let
the user edit only the active classification, so that a trait would not
be changed by mistake; the owner opened every column to editing on
2 October 2026, with undo and the double-click of section 2.1 as the
guard.

popnei, named in section 7, is the owner's population genetics
library in Rust, and popnei_web its web applications.

## 2. Windows

The table is in the main window, and the plots in windows of their own:
a window for each 3D scatter, one Plots window that holds every
histogram and bar plot, and one Maps window that holds every map
(section 2.2, decided by the owner on 4 October 2026). Inside the Plots
and the Maps windows each plot is a tile, a rectangle of the window with
its own title bar, and the window arranges the tiles by their number. A single window with panels the user moves and docks was
considered and not taken. It would need a docking system, which neither
the web views nor Tauri provide, and building one is a project of its
own.

### 2.1 The main window

The main window is a view of the table, with the groups panel beside
it.

- The table draws only the rows on screen, fetched from the backend a page
  at a time, so a table of tens of thousands of rows costs no more than one
  of a hundred.
- The table is linked like every other view. Selected rows are
  highlighted, clicking and shift-clicking rows selects individuals, and a
  filter shows all rows, only the selection, or only one group.
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
    new group is made another way, not by typing it in a cell.
  - A click on a row of a selection of several waits 500 ms, Windows'
    default double-click time, before it selects that row alone: the
    first click of a double-click would otherwise leave that row the only
    one selected, and "Apply to all selected rows" could not be used
    with the mouse.
- Above the table, a find bar, which reads as a sentence, column first
  (decided by the owner on 4 October 2026, in the place of the bar of
  2 October): a Column dropdown, "Any column" first and then every column
  from IndividualID on; an operator dropdown; the value; a checkbox "Show
  rows that don't match"; and a button "Select shown rows". The operators
  depend on the column:
  - a column of text, the IDs, and "Any column": "contains", "is" and
    "is missing";
  - a category or a column of countries: "contains", "is" and "is
    missing", where "is" offers a list of the column's groups in place of
    a field, first "Choose a group…";
  - a column of numbers, a latitude or a longitude: "=", "<", "≤", ">",
    "≥" and "is missing", read by a screen reader as "equals", "less
    than", "at most", "greater than" and "at least".

  The value is a field for a text or a number, the list of groups, or
  nothing for "is missing", whose field is greyed out. Typing shows only
  the rows that match, and an empty field, or "Choose a group…", shows
  them all. "contains" matches when the text is part of the cell, "is"
  when it is the whole cell, as "Whole cell" did; a cell matches by the
  text the table shows, case ignored and accents not, and a cell of a
  country also when the text is part of any of its ISO names or equals
  one of its codes. A group chosen in the list matches its individuals,
  and follows the group when it is renamed or when the groups are
  renumbered. A comparison reads the number with the decimal mark of the
  system's region, as the import does; a text that is not a number
  filters nothing, and the information bar says so, with the mark: "“1.5”
  is not a number: the decimal mark here is “,”" (the mark added by the
  owner on 4 October 2026). "is missing" matches the missing cells, "Any column is
  missing" a row with at least one. Apart from "is missing", a missing
  cell never matches, so a missing height is neither ≤ 1.5 nor > 1.5.
  "Show rows that don't match" shows the others, and turns "is missing"
  into "is not missing".
- When another column is chosen whose operators do not hold the one
  chosen, the operator becomes the column's first, "contains" or "=",
  and the text typed stays. When the column's role changes, or the
  group chosen is deleted, so that the filter no longer fits, the filter
  is cleared to the column's first operator with no value, and the
  information bar says why: "The filter on ESP was removed: the group was
  deleted." or "The filter on height was removed: its column changed
  role." Undoing the change does not bring the filter back, since the
  filter is not undone. The words are the assistant's, for the owner to
  review. The filter hides rows of the table only, not of the other
  windows, and the backend holds it and finds the rows. A button "Select
  shown rows" makes the rows the table shows the selection, in place of
  the one there was (decided by the owner on 2 October 2026); with no
  filter it selects every row (confirmed by the owner on 3 October
  2026). A list in which several groups are chosen, "is any of", is left
  for later.
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
- The selection is cleared in three ways (decided by the owner on
  4 October 2026):
  - Escape, in any window. One press does one thing: it drops a lasso
    waiting for Enter, else releases + or − pressed, else clears the
    selection. In a field being typed in, or with a dialog open, Escape
    keeps its own meaning there.
  - A second plain click on what holds exactly the individuals selected:
    the one point selected in the 3D scatter or the map of the
    individuals, the one row selected in the table, a country on the map
    of countries or a segment of the histogram. On a row it waits the
    500 ms of a double-click first, as a click on a row of several does,
    so that a double-click to edit a cell does not clear the selection.
  - Edit > Select None, with Shift-Cmd-A, Shift-Ctrl-A on Windows and
    Linux, the shortcut of GIMP and Illustrator; Finder's Option-Cmd-A
    would be Ctrl-Alt-A on Windows, where many keyboards type letters
    such as ą with it (the shortcut chosen by the assistant).

  A click on empty space still does nothing, since a selection cannot be
  undone.
- The groups panel lists the groups of the active
  classification, each with its colour, name and number of individuals. A
  dropdown above it chooses the active classification. It is where a
  group is selected and edited. It sits left of the table, as a
  sidebar. Its last row is the unassigned individuals, with their number,
  and it can be selected like any group. Decided by the owner on
  2 October 2026. How a group is edited there was decided by the
  owner on 3 October 2026. The app, its documents and its code say
  "group" where they said "population", since the owner prefers the
  plainer word (decided on 3 October 2026); "population" is kept for the
  biology, as in population genetics.

  - A click on a group selects it alone, and a click on the group
    selected alone selects none; Cmd-click, Ctrl-click on Windows and
    Linux, adds a group to those selected or takes it away; Shift-click
    selects every row from the last one clicked without Shift to it, the
    unassigned individuals included when they are among them, in the
    place of what was selected, as in Finder (Shift-click asked for by
    the owner on 3 October 2026). The table
    keeps every row and greys out those of the groups not selected, as a
    plot still draws the points of the other groups (decided by the
    owner on 3 October 2026; filtering the table to the groups selected
    was considered and left out, since + could then never reach a row
    outside them).
  - With one row selected, its row shows + and − after its number. With
    several, + is not offered, since it would have no one group to add
    to, and one − is shown on the last group selected, so that the list
    does not move; it takes the individuals out of whichever selected
    group they are in: "Remove selected from Spain and Peru", or "from
    the 3 selected groups". Edit group and Delete group need one group
    selected. No other row shows a button, so that the list stays short. Each is a button that
    stays pressed until it is pressed again, and pressing one releases
    the other; + pressed is blue and − pressed is red. Their tooltips
    say what they do, "Add selected to China" and "Remove selected from
    China", which a screen reader reads as their names, with the state
    pressed or not. Decided by the owner on 3 October 2026, after trying
    a first version in which each acted once on the selection.
  - While + is pressed, every individual that enters the selection, by a
    click, a shift-click, Space, Select shown rows, and later a lasso in
    a plot, goes into the group, out of the group it was in. While − is
    pressed, every individual that enters the selection and is in the
    group becomes unassigned; the others are left as they are. The rows
    selected when the button is pressed are changed at once. A row that
    leaves the selection is not changed. Each change is one command and
    one undo. The button is one state for every window, kept in the
    backend, so that a lasso in a plot does what a click in the table
    does.
  - The button is released by pressing it again, by Escape, by any other
    selection of groups, by choosing another classification, and by
    importing a table. With the unassigned individuals selected, + makes
    the individuals selected unassigned, and − is greyed out with the
    reason "Unassigned individuals are in no group to remove them from".
  - A click edits while + or − is pressed: the first click of a
    double-click on a cell adds its row before the cell opens. The
    assistant proposed accepting it, rather than waiting 500 ms before
    each change, and the owner did not object.
  - The information bar says what pressing the button did and how to
    stop: "3 individuals added to China. Rows you select now go to China
    too, until you press + again or Escape; Edit > Undo takes back each
    change." When the button is released, by any of the ways above, it
    says so: "Rows you select no longer go to China." The words of these
    messages are the assistant's.
  - Below the list, "Add group" opens a field, "Name of the new group",
    with Add and Cancel; Enter adds and Escape gives up. The new group
    has no individuals, even with rows selected, which stay selected; it
    goes last in the list, takes the first colour of the list of section
    5 that no group of the classification has, and is selected. The cell
    editor then suggests
    it. A name is refused, with the reason in the information bar and
    the field kept open, when it is empty, another group's, no country of
    ISO 3166 in a column of countries, or not a number in a column of
    numbers; spaces around it are ignored, and a country is kept as its
    code. A name of text has at most 30 characters, which the field
    enforces too, and no control character, such as a line break or a
    mark that turns the text right to left (decided by the owner on
    3 October 2026, after the review found a name of 10 million
    characters accepted). A column of TRUE and FALSE takes the one of the
    two it lacks, typed in any case, and Add group is greyed out once it
    has both (decided the same day). The field and its buttons, and the
    reasons a name is refused, were written by the assistant and shown to
    the owner.
  - When a group is selected, "Edit group" and "Delete group" appear
    beside Add group, each with its command in the core. Delete group
    deletes the group at once and asks nothing first, since Undo brings
    it back, in its place and with its individuals. Its individuals
    become unassigned, + or − pressed on it is released, and the
    information bar says how many individuals it left unassigned and
    how to undo: "The group Spain was deleted, and its 3 individuals are
    unassigned now. Edit > Undo brings it back." Edit group opens a form
    with "Name of the group", holding the group's name, and "Colour", the
    21 colours of section 5 as round swatches, the group's own ringed,
    each named for a screen reader and in its tooltip with the other
    group that has it, "Orange, used by Spain"; Save and Cancel, Enter
    and Escape. A name is refused for the reasons of Add group, with the
    reason in the bar and the form kept open; the group keeps its code,
    its individuals and its selection. Edit changes the name and the
    colour, and a colour only from the list, so that the groups stay
    apart for the common kinds of colour blindness (decided by the owner
    on 3 October 2026). The buttons, the form and the words were written
    by the assistant, for the owner to review.
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
- File > Open Example Table, after Import table…, imports a table of
  2,000 plants installed with the app, `example-plants.csv`, so that a
  new user can try every window before preparing a file of their own
  (decided by the owner on 4 October 2026, in the place of a demo
  installer). It is enabled with no table open, and imports the file as
  Import table… does, with its messages, replacing the table there is;
  so the roles are those the import guesses: latitude and longitude by
  their headers, and the column of countries a category, made a column
  of countries by choosing that role. The file is the demo table of
  `src-tauri/src/demo.rs`, the one `--features demo` loads, written by the
  core's export as a CSV with commas, the point and UTF-8, and a test
  checks that it still is. It is not a project: a change is kept by
  exporting it, as for any table. If the file is missing from the
  install, the bar says: "The example table installed with Vavilov
  Explorer is missing. Reinstalling the app puts it back." (decided by
  the owner on 4 October 2026).
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

A widget is one plot of some columns:

| widget | columns | where it is drawn |
|---|---|---|
| 3D scatter | three numeric columns | a window of its own |
| 2D scatter | two numeric columns | a tile of the Plots window |
| histogram | one numeric column | a tile of the Plots window |
| bar plot | one category | a tile of the Plots window |
| map of the individuals | a latitude and a longitude column | a tile of the Maps window |
| map of countries | a column of countries | a tile of the Maps window |

The same kind of widget can be open more than once, for example two
scatters of different principal components. A widget is created from a
Plot menu, which opens a small dialog to choose the columns, filled in
from the columns selected in the table once columns can be selected
there (below, for the 3D scatter). The dialog offers every column
whose role fits, so that a table with two latitude columns, `lat` and
`Latitude`, offers both to the map (decided by the owner on 2 October
2026). It can also be created by
right-clicking a column header or a group of selected headers. Both ask
the backend for the same thing.

Removing a column closes every widget that shows it. Undoing the
removal brings the column back but does not reopen those widgets.

The windows of the widgets, decided by the owner on 4 October 2026,
because a window for every plot left the user with too many windows to
manage:

- A 3D scatter has a window of its own, with its own groups panel, as
  below.
- The Plots window holds every plot drawn with D3: the histograms, the
  2D scatters, and the bar plots when they come. The Maps window holds every map, of the
  individuals and of countries. Each opens with its first plot and
  closes when its last plot is closed. A Plot item of the menu whose
  window is open adds a tile to it and brings the window to the front.
  The windows are named "Plots" and "Maps". If the system cannot bring
  the window to the front, the plot is added all the same, and the main
  window says so: "The histogram was added to the Plots window, which
  could not be brought to the front." (decided by the owner on 4 October
  2026).
- A window holds 6 tiles at most, and a plot past them is not opened:
  "No histogram was opened: the Plots window holds 6 plots at most.
  Close one to open another.", "the Maps window holds 6 maps at most"
  for a map (decided by the owner on 4 October 2026).
- Inside each, the plots are tiles of one size, arranged by their
  number: one fills the window; two or three are stacked one above
  another; four make two rows of two; five or six, two columns in three
  rows. The tiles are in the order they were opened, row by row. There
  is no button to enlarge a tile.
- The window has one groups panel, in a column at its right, which can
  be collapsed as in the 3D scatter's window. With five tiles, the last
  row has one tile and an empty place at its right: the panel
  moves into that place, no column is left at the window's right, and
  the tiles take the whole width of the window. The panel can be
  collapsed there too, and its place then stays empty. (The owner's
  idea; the panel moving between its two places is the assistant's
  reading, for the owner to judge on screen.)
- Each tile has a title bar with its name, "Histogram of height", and a
  button that closes it. Two tiles of the same plot, the same kind and
  the same columns, are told apart by a number after the first,
  "Histogram of height (2)": a new tile takes the smallest number no open
  tile of its plot has, and keeps it while it is open (decided by the
  owner on 4 October 2026). Under its plot each tile has its own count
  line, "Drawing 1,688 of 2,000 individuals: 312 have no value." The window has one
  information bar, across its bottom, for its messages, what the groups
  panel did and what was refused; it takes no space while it has no
  message.
- The keys act on the tile whose plot has the keyboard's focus: the
  arrows, + and −, and Home. A lasso stays in its tile. Escape and Edit >
  Select None act as in every window.
- A change of role that leaves a widget a column it cannot show closes
  its tile, and its window only when it was the last tile. Opening
  another table closes every window of widgets.
- Each map draws with a WebGL context of its own, the drawing surface a
  page gets from the graphics card. Chromium, and so WebView2, and WebKit
  are known to keep about 16 at once in a page and to take one away from
  the oldest past that; the figure was neither looked up in their
  sources nor measured here, nor whether the windows of the app share
  the limit. So the app keeps at most 16 plots drawn with WebGL open at
  once, 3D scatters and maps together, and does not open another: "No
  map was opened: 16 3D scatters and maps are open, as many as the
  graphics card is sure to draw at once. Close one to open another."
  (decided by the owner on 4 October 2026). Sharing one context between
  the tiles is not done now.
- A lasso stays in the tile it is drawn in, and a window has one lasso
  waiting at a time: a lasso drawn in one tile drops the one waiting in
  another, so that Enter applies the one the user drew last and Escape
  drops it, as in a window of one plot (the assistant's reading of the
  owner's "a lasso stays in its tile", confirmed by the owner on
  4 October 2026).
- Built in two steps on 4 October 2026, each shown to the owner before the
  next: the Plots window with the histograms, then the Maps window with
  both maps.

How the app layer and the windows keep them, decided by the assistant
on 4 October 2026 within the boundary of section 3:

- The app layer keeps, for each window of widgets, its label, its kind
  and its widgets, each with a number of its own and what it shows, in
  the order they were opened. A widget closed by its tile's button, or
  dropped by its window, is forgotten.
- Every window has a label, the name by which the backend and Tauri
  address it, never shown to the user: `scatter3d-1`, `plots-2`,
  `maps-3`, numbered from a counter that only grows. A Plots window
  closed and opened again gets a new number. Closing a window takes
  Tauri a moment after the app asks for it, and Tauri refuses to make a
  window whose label one of its windows still has; with one fixed label,
  a histogram opened right after the last tile was closed would find
  the old window still there, and fail to open.
- A window asks the app layer for its widgets when it starts, and again
  after a reload, and is sent the whole list on its channel, the stream
  through which the backend sends it every change, whenever a widget is
  added to it or closed and it keeps others. Each list has a sequence number that only grows, and the
  window keeps the newest, since an answer to its request and a message
  of its channel travel separately and can arrive in either order.
- A window draws the widgets its copy of the table can show, and asks
  the app layer to forget the others: a change of role that leaves a
  histogram's column no number drops its tile in the window that shows
  it, as it applies the change, so the tile never draws from a column
  the change left unfit. The rule of which column each kind of widget
  can show is the window's alone. The main window's dialogs offer only
  the columns that fit, and a widget asked for from a copy of a table
  replaced since is refused by the core, which knows when the table was
  loaded.
- The app layer closes a window whose last widget is forgotten, and
  every window of widgets when another table is loaded.
- The button of a tile asks the app layer to forget its widget, which
  only the widget's own window may ask. Closing the window forgets all
  of its widgets.
- Each kind of window has its capability, the list of the backend's
  commands its windows may call: `plots-*` and `maps-*` beside
  `scatter3d-*`.
- On macOS a click on a window that is not the active one only brings it
  to the front, unless the window is made to take that first click
  (section 10). The Plots window does not take it, as the histograms'
  windows did not, so that a click meant to bring the window forward
  does not replace the selection. The Maps window holds the map of the
  individuals, whose window took it, so that a pan or a lasso starts on
  the first press, and the map of countries, whose window did not, since
  there a click selects a country's individuals. Tauri sets it for a
  whole window, and the owner decided on 4 October 2026 that the Maps
  window does not take it: a first click on an inactive Maps window only
  brings it to the front, so on the map of the individuals a pan or a
  lasso starts on the second press. So does a pan or a lasso on a 2D
  scatter, which is in the Plots window.

The 3D scatter, decided by the owner on 3 October 2026, and its first
slice, built the same day:

- Plot > 3D scatter… opens a dialog, "3D scatter", with a dropdown for
  each axis, "X axis", "Y axis" and "Z axis", which offers the columns
  whose role is a number, a latitude or a longitude, in the order of the
  table, and Cancel and Open. It starts from the first three columns
  whose role is a number; with two, from the first, the second and the
  first, and with one, from it on every axis. A latitude or a longitude is
  rarely plotted against other numbers, so the dialog starts from them only
  when the table has no plain number, in the same way (decided by the owner
  on 4 October 2026). Starting from the columns selected in the
  table comes with the selection of columns, which does not exist yet,
  and so does "Create 3D plot" in the menu of a right-click on the
  headers. With no such column, the information bar of the main window
  says so as an error and no dialog opens: "No 3D scatter was opened: the
  table has no column of numbers. A column of numbers shown as a category
  becomes one when “number” is chosen as its role." The words are the
  assistant's, for the owner to review. Enter in the dialog does what Open
  does (decided by the owner on 3 October 2026).
- On a computer whose web view cannot draw WebGL, Plot > 3D scatter…
  opens no window, and the information bar of the main window says so as
  an error: "WebGL plots are not supported on this computer." A plot
  window that cannot draw although the main window could, which a
  graphics card that refuses one more drawing would cause, shows the same
  sentence in its place (decided by the owner on 3 October 2026).
- When a plot window is in front, an item of the app's menu that shows a
  dialog or a message in the main window, Plot > 3D scatter… among them,
  first brings the main window to the front (decided by the owner on
  3 October 2026).
- The window is named after its columns, "3D scatter of PC1, PC2 and
  PC3", and has an information bar at its bottom that says how many
  individuals it draws: "Drawing all 2,000 individuals." or "Drawing
  1,688 of 2,000 individuals: 312 have no value on an axis." An
  individual is left out when it is missing on an axis, or its value is
  beyond about 3.4 × 10^38 from the middle of its column's values, which
  the GPU cannot draw.
- A change of role that leaves an axis without a column of numbers, a
  number made a category, closes the window, as removing the column
  would, and undoing it does not reopen it; a change between number,
  latitude and longitude keeps it. Opening another table closes every
  widget. Proposed by the assistant on 3 October 2026, for the owner to
  confirm.
- Hovering a point shows its individual's ID, its group in the active
  classification, and its values in the first three columns of the
  table that are neither the IDs nor the active classification (decided
  by the owner on 3 October 2026), in a label beside the pointer; a
  missing value is written "missing".
- The points, built on 3 October 2026 from the prototype
  (`prototype-lessons.md`): each in its group's colour, an unassigned
  individual in grey, every point in one blue while there is no active
  classification; a group past the 21 colours of the list takes the
  next of five shapes, circle, square, diamond, cross and x. A point is
  8 CSS pixels across, with a ring of one pixel in the colour of the box's
  lines, which stands out from the background by at least 3 to 1, so
  that a point of a pale group, yellow on the light background, still
  has an edge (decided by the owner on 3 October 2026, after the review
  found 11 of the 21 colours of the list below 3 to 1 on the light
  background); with
  groups selected, those of the groups selected are 1.5 times as large
  and the others 0.4 times, as in the prototype. The individuals selected
  have a ring of the text's colour, two pixels wide, and are drawn at
  least 12 pixels across so that their colour shows inside it; the hover,
  from any window, is drawn 16 pixels across with the same ring. The
  sizes were chosen by the assistant, for the owner to judge on screen.
  The data is drawn over the box and its grid.
- The box has the names of the columns and round values on its edges;
  where two axes meet, the values of their ends can overlap.
- A drag rotates, the wheel zooms, a right drag pans, a double click
  frames the box again. The plot takes the keyboard's focus too, and then
  the arrows rotate, + and − zoom, and Home frames the box again (decided
  by the owner on 3 October 2026), since a drag is not something every
  user can make. While + or − is pressed a drag draws a lasso
  instead, and the plot does not rotate: the user releases the button to
  rotate (decided by the owner on 3 October 2026); the wheel still zooms.
  The lasso, a dashed line in the colour of the button pressed, blue for
  + and red for −, waits for Enter, with the individuals inside it ringed
  in that colour; Enter applies it, Escape drops it, and so does moving
  the camera, releasing the button, or pressing the other. It stays in
  its window. With + it puts the individuals inside it in the group
  selected, with − it takes those in a group selected out of it, one undo
  each.
- A click on a point selects its individual alone, and Cmd-click on
  macOS, Ctrl-click on Windows and Linux, adds it to the selection or
  takes it away; on macOS a Ctrl-click is the system's secondary click,
  and does nothing on a point (decided by the owner on 3 October 2026). A
  second click on the one point selected clears the selection, and so
  does Escape (section 2.1). A click on empty space does nothing, since a
  selection cannot be undone (decided by the owner on 3 October 2026). While + or − is
  pressed a click selects too, and so puts the individual in the group or
  takes it out, as a click in the table does.
- Each plot window has the groups panel of the main window, the same
  component doing the same things, in a panel at its right that can be
  collapsed, so that the user puts individuals in groups without going
  back to the main window; the panels of every window show one state, the
  backend's, so a group selected or + pressed in one shows in all (decided
  by the owner on 3 October 2026; section 12 had deferred a compact key).
  The 3D scatter's panel has + and − on the group selected, but no Add,
  Edit and Delete group, which the main window has (decided by the owner
  on 4 October 2026).
- The values of a column are sent to the plot window as their distance
  from the middle of the column's range, so that values far from zero and
  close together, positions on a genome or coordinates in metres, are not
  drawn on top of one another (decided by the owner on 3 October 2026;
  `core.md`, section 5).
- A refused command of the window, a lasso whose group was deselected in
  another window meanwhile, is written to the console, as in the main
  window, until section 12 decides how a window tells it.

The two maps, decided by the owner on 3 October 2026:

- Plot > Map… opens a dialog, "Map", with "Latitude column" and
  "Longitude column", each offering the columns of its role and starting
  from the first; Plot > Map of countries… opens "Map of countries", with
  "Country column", which offers the columns whose role is country. The
  3D scatter's dialog is the same dialog with its three axes. With no
  column of a role a map needs, no dialog opens, and the information bar
  of the main window says so as an error: "No map was opened: the table
  has no latitude column. A column of numbers from −90 to 90 becomes one
  when “latitude” is chosen as its role.", the same for a longitude, from
  −180 to 180, and "No map of countries was opened: the table has no
  column of countries. A column of text that names countries by their ISO
  codes or names becomes one when “country” is chosen as its role."
- Both maps are tiles of the Maps window (above), whose groups panel has
  no Add, Edit and Delete group, as the 3D scatter's, and has + and − on
  the group selected (decided by the owner on 4 October 2026). On a map
  of the individuals they arm its lasso; on a map of countries, while + or
  − is pressed, a click on a country puts its individuals in the group or
  takes them out, as a click selects them. Escape in the Maps window
  releases + or − pressed in any window.
- The map of the individuals, "Map of lat and lon", draws a point for each
  individual with a latitude and a longitude, as the 3D scatter does. The
  world is drawn flat, as web maps draw it (the Web Mercator projection,
  which stretches the land towards the poles and ends at 85.05° north and
  south), with the borders of the countries from Natural Earth, a public
  map of the world (section 12). A place beyond 85.05° is drawn on the
  map's edge, and the map does not wrap around at 180°. It opens showing
  the individuals, and shows at least about 9° of longitude, so that one
  individual alone is shown with the land around it. Its tile's count line
  says "Drawing 1,688 of 2,000 individuals: 312 have no coordinates."
- Where points overlap, the individual under the pointer is drawn on top,
  then those selected or inside a lasso, then those of the groups
  selected in the panel, and the rest below.
- A drag pans, the wheel zooms where the pointer is, and a double click
  shows all the individuals again; with the keyboard's focus on the map
  the arrows pan, + and − zoom, and Home shows them all again. The label
  of the individual under the pointer, the clicks that select, and the
  lasso are the 3D scatter's. To draw a lasso, the user presses + or − in
  the map's groups panel, or in any other window's, then drags on the
  map, which no longer pans meanwhile, and presses Enter to apply the
  lasso or Escape to drop it, as in the 3D scatter. While + or − is
  pressed, the map's cursor is a cross.
- The map of countries, "Map of countries in origin", fills each country
  by how many individuals the column puts in it, whatever the find bar
  shows. With no group selected in the groups panel it counts every
  individual; with groups selected, only the individuals in them, in the
  active classification, and "Unassigned" selected counts those in no
  group (decided by the owner on 4 October 2026). When the active
  classification is the column of countries itself, selecting ESP leaves
  Spain alone coloured. The scale's dark end is the most in a country
  among those counted, so one blue means different counts as the groups
  change, and the legend's top number says which. A country with none in one
  grey, both one the column never names and one that is a group of the
  column with no individual left in it, and the others on a scale of
  blue, linear, from a light blue at one individual to a dark blue at the
  most in a country; in the dark appearance the scale runs from a dark
  blue to a light one. A legend over the map's lower left corner shows the
  grey, "No individuals", and the scale with its two ends, "1" and the
  most; a screen reader is given the scale as a sentence, "From 1 to 5
  individuals" (decided by the owner on 4 October 2026). With groups
  selected, a line under the legend's heading names them, "in ESP and
  PER", and the sentence ends with it, "From 1 to 5 individuals in ESP
  and PER". The tile's count line says whose individuals are counted:
  "Counting the 312 individuals in ESP and PER, of 2,000.", or "Counting
  300 of the 312 individuals in ESP and PER: 12 have no country."; the
  unassigned individuals are named "in no group", and past three groups
  the others are counted, "in ESP, PER, MEX and 4 other groups". The
  words are the assistant's, for the owner to review.
- Some places have no shape of their own in Natural Earth's map: it draws
  French Guiana, Guadeloupe, Martinique, Réunion and Mayotte as part of
  France and Svalbard as part of Norway, and has nothing for Gibraltar,
  Tuvalu, Tokelau, Bouvet Island, Christmas Island, the Cocos Islands,
  Bonaire and the United States Minor Outlying Islands; nor does it draw
  former countries, such as the USSR. The individuals of such a place are
  not added to any country of the map: France is not coloured by French
  Guiana's. They are left out of the map, and its count line says how
  many and where: "Counting 1,920 of 2,000 individuals: 60 have no
  country, and 20 are in French Guiana, which the map has no shape for."
  It names the three such places with the most individuals, and counts
  the others. Somaliland, Kosovo, N. Cyprus, the Siachen Glacier and the
  Indian Ocean Territories, which Natural Earth draws and ISO gives no
  code, are drawn in the grey of none: no individual can be in them, and
  those of Somalia and Cyprus are not drawn in Somaliland and N. Cyprus
  (decided by the owner on 4 October 2026).
- A country is named by its common name, "Russia", "Bolivia", "South
  Korea", "Democratic Republic of the Congo", "Soviet Union", and not by
  ISO's longer official one, which a list in the bar would split at its
  comma (decided by the owner on 4 October 2026). It is the common name
  of iso-codes where it has one, else a name the core's generator
  (`scripts/countries.mjs`) writes for the countries whose ISO name is
  not the common one, 24 of them, else ISO's name. A file may still name
  a country only by its ISO codes or names (section 6).
- The pointer over a country shows "Spain (ESP): 312 individuals", by its
  common name and the code the table shows, or "Morocco: no individuals", by
  Natural Earth's name; it shows only in the map's window, since the
  hover the windows share is of one individual. A click on a country
  selects its individuals alone, those the map counts there when groups
  are selected (chosen by the assistant on 4 October 2026, so that a click
  selects what the colour shows; for the owner to confirm), and
  Cmd-click or Ctrl-click adds them to
  the selection, or takes them away when all of them were in it; a click
  on a country with none, or on the sea, does nothing. Each country that
  holds an individual selected has a line in the text's colour around it,
  drawn over a wider line in the background's colour so that it shows on
  the darkest blue as on the lightest.
- On macOS, when the Maps window is not the active window, a first click
  on either map only brings it to the front, so that a click meant to
  bring the window forward does not change the selection; a pan or a
  lasso on the map of the individuals starts on the second press
  (decided by the owner on 4 October 2026; before, the map of the
  individuals had a window of its own that took the first click). On
  Windows and Linux the first click always acts (section 10), and there
  it selects a country's individuals.
- A change of role that leaves a map a column it cannot show closes its
  tile, and the Maps window with its last,
  as a column removed would: a latitude or a longitude made anything
  else, a plain number among them, since a later edit could then put a
  value off the globe, and a column of countries made a category or text.
  Undoing it does not reopen the map. This rule was chosen by the
  assistant and is for the owner to confirm. Opening another table closes
  every map, as it closes every widget.
- WCAG asks 3 to 1 between the marks of a plot and what is beside them.
  The dark blue of the most individuals meets it against the grey of none,
  at 10.1 to 1 in the light appearance and 8.8 in the dark. The light
  blue of one individual does not, at 1.34 and 1.55 to 1: it differs from
  the grey by its hue, and the label of a country gives its count.

The 2D scatter, decided by the owner on 4 October 2026 (issue #7):

- It behaves as the 3D scatter does, with two exceptions: it does not
  rotate, which means nothing in two dimensions, and each is a tile of
  the Plots window, beside the histograms, not a window of its own.
- Plot > 2D scatter… opens a dialog, "2D scatter", with a dropdown for
  each axis, "X axis" and "Y axis", which offers the columns the 3D
  scatter's does. It starts from the first two columns whose role is a
  number, and with one, from it on both axes; from the latitudes and the
  longitudes only when the table has no plain number. With no such
  column the bar says so, as for the 3D scatter: "No 2D scatter was
  opened: the table has no column of numbers. …".
- The tile is named after its columns, "2D scatter of PC1 and PC2", and
  counts its individuals as the 3D scatter's window does: "Drawing 1,688
  of 2,000 individuals: 312 have no value on an axis."
- It is drawn in SVG with D3, as the histogram is, not with WebGL: it
  does not count among the 16 plots drawn with WebGL, and counts among
  the 6 tiles of the Plots window. Measured on the owner's Mac on
  4 October 2026, in the e2e harness, a debug build, the median of 5
  runs: with 2,000 individuals a frame of pan and a hover each draw
  within the two animation frames the measurement waits, 32 to 33 ms;
  with 50,000, a frame of pan takes 84 ms in WebKit and 48 ms in
  Chromium, and a hover 86 and 52 ms. A pan moves one group that holds
  every point, and a new style touches only the points whose style
  changed; before these two, the same 50,000 took 148 and 122 ms in
  WebKit and 117 and 105 ms in Chromium.
- An axis at the bottom for the first column and one at the left for the
  second, with ticks at round values, each named after its column, and a
  light grid at the ticks behind the points.
- The points have the 3D scatter's colours, shapes, sizes and rings, and
  the same order: the hover over the selection over the rest. The
  pointer, the clicks, the hover's label and the lasso with + and − are
  the 3D scatter's.
- It pans and zooms as the maps do: a drag pans, the wheel zooms where
  the pointer is, and a double click frames every point again; with the
  keyboard's focus on it, the arrows pan, + and − zoom, and Home frames
  every point again. While + or − is pressed, a drag draws a lasso and
  does not pan. The pan and the zoom are the app's own code, not D3's
  `d3-zoom`, which would be a new dependency.
- A change of role that leaves an axis without a column of numbers
  closes its tile, as for every tile.

The histogram, decided by the owner on 4 October 2026 and built in two
steps: first the bars of one column, stacked by group, their clicks and
the groups panel; then the hover of another window and the number of
bins.

- Plot > Histogram… opens a dialog, "Histogram", with "Column", which
  offers the columns whose role is a number, a latitude or a longitude,
  and starts from the first plain number, as the 3D scatter's does. With
  no such column, the information bar of the main window says so as an
  error: "No histogram was opened: the table has no column of numbers. A
  column of numbers shown as a category becomes one when “number” is
  chosen as its role." The histogram is a tile of the Plots window
  (above), named after its column, "Histogram of height".
- The values are cut into 20 bins of equal width, from the lowest value
  to the highest (the number chosen by the owner; a field to change it
  comes in the second step). The vertical axis counts individuals, and is
  named "Individuals"; the axis of the values is named after the column
  (the assistant's, for the owner to judge). The tile's count line says
  how many it draws, "Drawing 1,688 of 2,000
  individuals: 312 have no value."
- Each bar is stacked by the groups of the active classification. With no
  group selected, every group is drawn in its colour, in the order of the
  groups panel, the unassigned individuals last, in their grey. With
  groups selected, those groups are drawn at the bottom of each bar, in
  their colours and the panel's order, where their heights can be read
  against the axis, and the individuals of every other group, and those
  unassigned, as one segment above them, in a grey paler than the
  unassigned individuals', so that the two part when the unassigned are
  the group selected. With no active classification, each bar is one
  segment in the points' blue. Every segment has an edge of one pixel in
  the grey of the box's lines, as the points of a point view have a ring,
  so that a pale group shows on the background, at least 3 to 1, and two
  segments of one bar part (both decided by the owner on 4 October 2026,
  after the review found a yellow bar at 1.2 to 1 on the light
  background).
- The individuals selected are drawn at the bottom of each segment they
  are in, with a border in the text's colour around them, so that the
  border shows how many of the segment are selected (the owner asked for
  a border around the selected individuals; drawing it around their
  share rather than around the whole bar is the assistant's reading, for
  the owner to judge on screen).
- A click on a segment selects its individuals alone: a group's in that
  bin, or the grey ones; a second click on it, when they are the whole
  selection, selects none, as a second click on a group of the panel
  does (decided by the owner on 4 October 2026). Cmd-click on macOS, Ctrl-click on Windows and
  Linux, adds them to the selection, or takes them away when all of them
  were in it; Shift-click selects the same segment of every bin from the
  one last clicked. A click on empty space does nothing. A drag across
  bars comes in the second step. The pointer over a segment names it,
  "ESP: 12 individuals, 1.5 to 2", or "Other groups: 40 individuals, 1.5
  to 2" for the grey one; the words are the assistant's. Escape hides the
  label, which can cover the groups panel, until the pointer moves
  (decided by the owner on 4 October 2026).
- The Plots window has the groups panel with + and − on the group selected and
  no Add, Edit or Delete group; while + is pressed a click on a segment
  puts its individuals in the group, as a click selects them. On macOS a
  click does not act while the window is inactive, as on the map of
  countries; on Windows and Linux the first click always acts (section
  10), and there it selects the segment's individuals.
- A change of role that leaves the column no number closes the tile, as
  it closes a 3D scatter's window.
- In the second step, the individual under the pointer in another window
  is shown by a line around its bin.

Bar plots select too: clicking a bar selects the individuals in it, and
the selected share of each bar is drawn inside it. Each widget shows how
many rows it cannot place, for example "312 without coordinates". Those
rows are still in every other view.

The windows of the widgets, a 3D scatter's, the Plots and the Maps
windows, are top-level windows, not child windows of the main window. In
Tauri a window can be given a parent. On macOS that attaches it to the
parent, so it moves with it. On Windows it makes the child always sit
above the main window and hide when the main window is minimized. Both
get in the way of a layout spread over two monitors.

### 2.3 Closing and quitting

Closing a 3D scatter's window closes the scatter; the button of a tile
closes the tile, and closing the Plots or the Maps window closes every
tile in it. Closing the main window ends the session: if there are
unsaved changes the app asks to save them, then quits and every other
window closes with it. Quitting from the menu or with Cmd-Q goes through
the same question. On macOS, clicking the app in the Dock with no window
open shows the main window again.

### 2.4 Layouts

The project saves which widgets are open, the columns each one shows,
the window each is in and its order there, and the size and position of
each window. Opening the project restores
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
  groups and their colours. It is saved in the project and every
  edit to it can be undone.
- **The interaction**: the active classification, the selected
  group, the selection and the hover. It is shared by every window
  and lives in the backend, but is not undone. The active classification
  is also saved in the project, so that it opens the way it was left.
- **The window's own**: the camera of a 3D view, a lasso outline being
  drawn, the scroll position of the table. It stays in its window and the
  backend never sees it.

Every change to the document or the interaction is a command, a call from
a window to the backend, such as "assign these rows to group A",
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
each point from the groups and the selection, is computed in each
window by one TypeScript function shared by all of them. The state has
one place and the computation has one implementation.

All of this lives in a Rust core that does not depend on Tauri: a
session, which holds the state, and a dispatcher, which applies commands
to it. The Tauri commands are thin wrappers around the dispatcher. This
is what lets the tests of section 11 run the real backend without Tauri.

The core knows the data and the calculations on the data, and nothing of
the windows (decided by the owner on 4 October 2026). What the windows
show, which plots are open, in which window, and where the windows are,
belongs to the app layer, the Rust of `src-tauri` that makes the windows,
and to the windows themselves:

- the core sends its changes to subscribers it knows by a name it does
  not read, and never opens, closes or names a window;
- the app layer keeps the list of the open plots of each window, opens,
  brings forward and closes the windows, and tells a window when a plot
  is added to it; it keeps this in a module that does not depend on
  Tauri, so that the test program of section 11 runs the same code;
- a window decides from its copy of the table which of its plots it can
  still draw, and closes the others itself, as after a change of role;
- the core reads and writes the project file, and stores in it the data
  of the windows that the app layer gives it at a save, and gives it
  back at a load, without reading it (section 8).

The items of the menu and the refusals about windows, an unknown window,
an unknown widget and a window the system could not open, are the app
layer's too. The app layer sends a window its own messages, an item of the
menu or a list of widgets, through the session's channel to that window,
as bytes the core does not read, so that each window has one channel.

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
that no row uses yet, which is how a new, empty group exists. Each
level has a colour.

The levels are ordered when they are built, by the import or by a
change of role: text in the order of the names below, numbers as
numbers, and FALSE before TRUE. The colours come from a fixed list, given
to the levels in that order. From then on each level
keeps its colour: a group added later takes the first colour of the
list no other level of the column uses, and renaming a group does
not change its colour. The list has 21 colours (below); a column of more
levels starts the list again, so that two levels share a colour, which
the owner accepted on 2 October 2026 until there are more groups
and more views to judge it by. The order of text is
with case ignored, ties broken by the exact text, and numbers inside a
name are compared as text, not as numbers. The list is Okabe and Ito's
without its black, seven colours from orange, then the same mixed with
40 % white, then with 40 % black (decided by the owner on 2 October 2026,
`core.md`, section 10). The user can give a group another colour of
the list with Edit group (section 2.1), and no colour outside it
(decided by the owner on 3 October 2026). Colours are part of the
document, saved in the project and undone like any other edit.

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
    trait such as the colour of the flower or groups such as a
    genetic clustering; drawn in a bar plot, and any category can be the
    active classification, which + and − in the groups panel
    edit;
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
  current one uses is shown by its four-letter code. A new group of
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
levels of a category keep the storage type, so that group codes 1,
2 and 10 are ordered as numbers, and an export writes them back as
numbers. A change of role is a command and can be undone, and undoing a
change to country gives back the file's spellings. Any category, of
countries or not, can be the active classification; one whose role is
changed to a number or text stops being active, and one whose levels are
built again, between category and country, loses its selected
group. A change that would stop the active classification asks
first, since one key pressed on the dropdown is enough to make it, and
the interaction is not undone: "Make “origin” text?", with what follows
from it and how to choose the column again, and the buttons "Keep it a
category" and "Make it text";
Escape keeps it (decided by the owner on 2 October 2026).

The list of countries is a table in the core, generated once from the
data of Debian's `iso-codes` (ISO 3166-1 and 3166-3, their codes, names
and official names), and committed with its source, its date and the
SHA-256 of what was read; it is generated again when ISO changes a
country. It holds, for each country by the code it is shown by, its
common name (section 2.2) and, for a current one, its ISO numeric code, which names its shape
on the map of countries (section 2.2); the description of a column of
countries gives both with each level. A name a current and a former country would share goes to the
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
active classification, so that its groups show at once, and none is
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

A `.vav` file is a zip archive, as an xlsx is, with three files in it:

- `table.parquet`: the data. Parquet is a standard binary format for
  tables that stores each column's type, its missing values and exact
  floats, and that R, pandas and polars read. A category or a
  classification is stored in its storage type, so a reader in another
  program sees the values of the groups, not their codes. CSV was considered and not taken: it has
  no types, and in CSV a text value "NA" and a missing value cannot be
  told apart without an escaping of our own.
- `project.json`: what Parquet cannot hold, which is a version of the
  format, each column's id, the role of each column, and for a category or a
  classification the order of its levels and their colours, and the active
  classification.
- `layout.json`: the layout of the windows (section 2.4), the plots open
  in each window and the size and position of each, written by the app
  layer. The core stores it as the app layer gives it at a save and gives
  it back at a load, and never reads it (section 3); its format and its
  version are the app layer's. A layout the app layer cannot read, as one
  of a newer version of the app, is said so to the user, and the table
  opens without its windows.

A change of the layout alone, a plot opened or closed or a window moved,
is no unsaved change: quitting after it asks nothing, and the layout is
saved with the next save of the data (decided by the owner on 4 October
2026).

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
- **The histograms and the bar plots**: SVG, drawn by the plot's own
  code (`src/plots/histogram.ts`), with D3's `d3-scale` 4.0.2 for the
  linear scales and their round tick values. A plot has a few hundred
  rectangles at most, whatever the number of individuals. The bins are
  cut in `src/state/histogram.ts`, since the state layer takes no D3, and
  the bars and the two axes are SVG elements the plot makes, about 30
  lines: `d3-selection` and `d3-axis`, first planned for them, ship no
  types, and declaring their generic interfaces would be a long claim the
  compiler cannot check (decided by the assistant on 4 October 2026). A
  drag across bins, in the histogram's second step, may take `d3-brush`
  or be written alike. The plot owns its SVG, and lit-html never renders
  inside it, so that no element is changed by both. D3 is not used for the point
  views: 50,000 points in SVG would be slow, and Plotly, tried in the
  prototype, sent every point again on each edit (`prototype-lessons.md`).
- **The table**: rows of a fixed height, of which only those on screen
  are in the DOM, written for the app.
- **Everything else drawn as HTML**: the groups panel, the
  dropdowns of the column types, the dialogs, the empty state, the
  messages. These are rendered with lit-html, a library of about 3 kB
  (version 3.3) that updates the DOM from a template and does nothing
  else. A view is a function from the state to a template, and its
  controller calls it whenever the state changes, so a list whose
  groups are added, renamed or removed cannot be left with stale
  rows, listeners or focus.

Native HTML elements are used where they exist: `<select>` for the types
and for the active classification, `<dialog>` for the dialogs, and radio
buttons, drawn as swatches, for the colour of a group, which comes
from the list of section 5 alone. They bring the keyboard handling and
the accessibility that would otherwise come from a library of components.

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
  window, not for each gesture. The 3D scatter's window sets it, so that a
  lasso or a rotation starts on the first press, as on the other
  platforms. The Plots window, the Maps window and the main window do not,
  because there a single click changes the shared selection, which cannot
  be undone, and a click meant only to bring the window forward would
  replace it; in the Maps window this delays a pan or a lasso on the map
  of the individuals to the second press (decided by the owner on
  4 October 2026).
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
  window may call, names windows by their label, so the windows of the
  widgets get labels such as `scatter3d-1` and `plots-2`, and one
  capability covers each kind with a pattern.

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
  owner noted on 2 October 2026 that the selected group may be
  shown by size, and the colour may follow another column; separating
  the two is the guard against editing a trait by mistake that the
  merge of category and classification left (section 6).
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
- The group of one individual is changed from the table by typing
  the group's name in the cell of the active classification, with
  the names of its groups suggested as the user types. A name that
  is not yet a group is refused: a new group is made with Add
  group in the groups panel (decided by the owner on 3 October 2026,
  section 2.1).

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
- The colours of the groups start from Okabe and Ito's list, which
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
- Every text that enters the app is kept in Unicode's composed form,
  NFC, so that an accent written as part of its letter, as typing gives
  it, and as a separate character after it, as a Mac often writes file
  names, is one text: `Perú` from a file and `Perú` typed are one group.
  It is applied to every text of an imported file, its IDs, column names
  and values, and to what the user types, in a cell, as a group's name,
  and in the find bar. Two IDs, or two column names, that become one
  are refused at import, naming the name. Decided by the owner on
  3 October 2026, with the crate `unicode-normalization`, 0.1.25, of the
  unicode-rs project, MIT or Apache-2.0, whose one dependency, `tinyvec`,
  was in `Cargo.lock` already.
- Three.js is taken at 0.186.1, with its TypeScript types from the
  development package `@types/three` 0.186.0 (DefinitelyTyped), which add
  nothing to the app (approved by the owner on 3 October 2026).
- The maps take two npm packages, approved by the owner on 3 October
  2026, both by Mike Bostock under the ISC licence and last published in
  June 2022: `world-atlas` 2.0.2, the Natural Earth borders in TopoJSON,
  with no dependency, of which the app uses `countries-50m.json`, 756 kB,
  read only by the Maps window; and `topojson-client` 3.1.0, 68 kB, which
  turns it into the borders, each shared border once, and the shapes of
  the countries. Its one dependency, `commander` 2, is for its command
  line tools and reaches no build. It ships no types: the two functions
  the app calls are declared in `src/plots/topojson-client.d.ts`, with
  their answers unknown and checked where they are read. world-atlas
  names each country by its ISO numeric code; the core's list of
  countries has them from the same iso-codes files (section 6). Of the
  249 current countries of ISO, 235 have a shape on the map; the other
  14 are the places listed in section 2.2.

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
