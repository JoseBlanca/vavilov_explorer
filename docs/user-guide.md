# Vavilov Explorer: preparing your table

This guide, of 2 October 2026, says how to prepare the table you import
into Vavilov Explorer, so that the import accepts it and every column can
be used the way you want.

Vavilov Explorer reads one table, a CSV, TSV or Excel file, with one row
per individual (an accession, a plant, an animal) and one column per
variable. The first row holds the names of the columns.

## The first column: IndividualID

The first column holds the ID of each individual, and its header must be
`IndividualID`. Case, spaces and underscores do not matter, so
`Individual ID`, `individual_id` and `INDIVIDUALID` are accepted too.

- Every row needs an ID, and no ID may appear twice.
- IDs are kept exactly as written: `001` stays `001`, and `NA` is an ID,
  not a missing value.
- A file whose first column has another header, such as `accession`, is
  refused: nothing of it is imported, and the message names the header
  found. Rename the column and import the file again.

## Missing values

In every column but the first, three things mean a missing value: an
empty cell, `NA` and `-`, written exactly so. `na`, `N/A` and `n.d.` are
text, not missing values. Do not use `NA` or `-` for a real value: in a
column of two-letter country codes, Namibia's code `NA` is read as a
missing value, so write Namibia as `NAM` or `Namibia`.

## Importing it

Choose File, Import table… and pick the file. A CSV or a TSV is read
with the separator, the decimal mark and the encoding found in it, and
an Excel workbook from its first sheet that is not hidden. The file can
be of up to 20 MB, and the sheet of up to 2,000,000 cells, counted from
its first value to its last. A file that
cannot be imported loads nothing, and the bar at the bottom of the
window says what was found and where, by its line in a CSV, or its row
and column in the sheet. Close the message with × when you have read
it; a warning, such as a character of the file that could not be read,
goes by itself after 5 seconds. When several messages are waiting, the
bar says how many more there are, and the next shows when one goes. A
table imported clears the messages about the one before.

Each column but the first gets a role from its values, which you can
change: a column of numbers is a number, or a latitude or a longitude
when its header is `lat` or `latitude`, `lon`, `long` or `longitude` and
its values fit; a column of `TRUE` and `FALSE` is a category; a column
of text is a category when it has from 1 to 20 different values, not
counting missing ones, and text when it has more. A column with no
values, every cell missing, is text. The leftmost category becomes the
Classification column of the populations panel, so its populations show
at once; a table with no category starts with None there.

## Exporting it

File, Export as CSV… and Export as Excel… write the table to a new file.
A CSV asks for its separator, its decimal mark, its encoding and how a
missing value is written. With the comma as the separator, the decimal
mark is the point: a decimal comma would put every decimal number in
quotes, and the table would not import back as numbers. Choose UTF-8 for
Excel when the file will be opened in Excel: Excel shows the accents of
a plain UTF-8 file wrongly. A category is written as its values, and a
column of countries as their three-letter codes. The export refuses a
value that would not read back as itself, such as a text `NA`, and the
message names its column and its individual.

## Finding rows

The bar above the table shows only the rows that match what you type in
Find, as you type. Column chooses where to look: Any column, the first
column included, or one column. A cell matches when what you typed is
part of what the table shows in it, capital letters or not; accents
count, so `cote` does not find `Côte`. Tick Whole cell to find only the
cells that are exactly what you typed, so that `1` does not find `10`.
Tick Show rows that don't match to see the others instead. Select shown
rows selects the rows shown, in place of those selected before; with
nothing typed in Find it selects every row. An empty cell
never matches, so it shows among the rows that don't match.

A decimal number is found as the table shows it, with your region's
decimal mark: `1,5` in Spain. A country is found by any of its ISO names
or codes, so `Spain`, `Kingdom of Spain`, `ES` and `ESP` all find the
cells shown as `ESP`. The search hides rows of the table only; the
other views keep every individual. The bar below the table says how
many rows are shown, "Showing 312 of 2,000 individuals", and how many
are selected. Importing another table clears the search.

## Editing a cell

Double-click a cell to change it, type the new value, and press Enter or
click elsewhere; Escape leaves the cell as it was. With the keyboard,
press Tab until the table has the focus, move with the arrow keys, Home,
End, Page Up and Page Down, and press Enter to change the cell; Enter
then applies the value and moves to the cell below. Space selects the
row of the cell, Shift-Space the rows from the last one selected, and
Shift with the up or down arrow, Page Up or Page Down extends the
selection as you move. Every column
can be edited. A value must be of the kind the column holds: a whole
number, a decimal number written with your region's decimal mark, `1,5`
in Spain, `TRUE` or `FALSE`, or text. A latitude must be from −90 to 90
and a longitude from −180 to 180. In a category the cell suggests its
values as you type, and the value must be one of them; a country can be
typed by any of its ISO names or codes. For a missing value, delete
the text and press Enter. A value that does not fit is refused, the bar at the
bottom of the window says why, and the cell keeps its value.

To give one value to many individuals, select their rows, double-click
a cell of one of them in the column to change, tick Apply to all
selected rows beside the cell, which is offered while several rows are
selected, type the value and press Enter. Every
selected row takes it, or none does when it does not fit, the bar
saying why, and one Undo
takes it back from all of them. An IndividualID is changed one at a
time, and two individuals cannot have the same.

## Undoing an edit

Edit, Undo, or Cmd-Z (Ctrl-Z on Windows and Linux), undoes the last
change to the table, such as a cell edited or a column's role changed,
and Edit, Redo, or Cmd-Shift-Z, makes it again. Each can be repeated,
back to the table as it was imported. Importing another table starts its history
afresh. The selection and the choice of the Classification column are
not undone.

## What each column is for

After the import, each column but the first has a role, which you choose
in the dropdown at the top of the column:

- **Number**: values drawn on an axis or in a histogram.
- **Category**: values that divide the individuals into groups, such as
  the colour of the flower, the country of origin or a genetic
  clustering. A category is drawn in bar plots, and you can choose any
  category in the populations panel to work with its groups as
  populations: to colour the plots by them, and to move individuals
  from one to another by drawing around them in a plot. Moving
  individuals changes the column in the app, never the file you
  imported; you choose which category to edit, so take care not to edit
  a trait you recorded by mistake.
- **Text**: notes and identifiers, shown in the table only.

Three roles are more particular forms of these, for columns whose every
value fits them: **Latitude** and **Longitude**, numbers the map uses to
place each individual, and **Country**, a category whose values are
countries. The dropdown lists only the roles a column can take, and you
can change a column's role at any time, and its values are kept.

The column chosen as the Classification column, in the populations
panel, must be a category. When you would make it a number or text, the
app asks first, with a button that keeps the column's role and one that
changes it; Escape keeps it too. After the change, the Classification
column shows None until you choose a category there.

### Latitude and longitude

A column of numbers can be a latitude when every value is from −90 to
90, and a longitude when every value is from −180 to 180, written as
decimal degrees: `40.4168`, `-3.7038`. Missing values are allowed.
Coordinates in metres, a longitude from 0 to 360, or degrees written as
text such as `40°25'N` cannot be a latitude or a longitude; convert them
to decimal degrees in the file first.

### Countries

A column of text can be a country when every value names a country.
The countries are those of ISO 3166, the international standard list of
countries and their codes, and a value can name one in either of these
ways:

- its two-letter code, such as `ES`, or its three-letter one, such as
  `ESP`;
- its English name as ISO 3166 writes it, such as `Spain`, or
  `Bolivia, Plurinational State of`, or its official name, such as
  `Kingdom of Spain`.

Shorter everyday names are accepted only when they are ISO's own:
`Bolivia`, `South Korea`, `Russia` and `Vietnam` are not, so write
`Bolivia, Plurinational State of`, `Korea, Republic of`, `Russian
Federation` and `Viet Nam`, or the codes `BOL`, `KOR`, `RUS` and `VNM`.

Case and spaces at either end do not matter; accents do, so write
`Côte d'Ivoire`, not `Cote d'Ivoire`. Names in other languages, such as
`España`, are not accepted. Once the column is a country column, every
value is shown as its three-letter code, so `ES` and `Spain` become one
population, `ESP`.

Countries that no longer exist, such as the USSR or Yugoslavia, are
accepted as ISO 3166 lists them:

- by their ISO name, which is often long: `USSR, Union of Soviet
  Socialist Republics`, not `USSR`;
- by their four-letter code, which ISO 3166 gives every former country:
  `SUHH` for the USSR, `YUCS` for Yugoslavia, `CSHH` for Czechoslovakia,
  `DDDE` for the German Democratic Republic, `ZRCD` for Zaire;
- by their two- or three-letter code, such as `SU` or `SUN`, unless a
  country that exists today now has that code. For example, `AI` was the
  French Territory of the Afars and the Issas and is now Anguilla, so
  `AI` means Anguilla; write the former territory as `AIDJ` or by its
  name.

A country that no longer exists is shown by its three-letter code: the
USSR as `SUN`, the French Territory of the Afars and the Issas as `AFI`.
When a country that exists today has that three-letter code, the former
one is shown by its four-letter code: the French Southern and Antarctic
Territories as `FQHH`, since `ATF` is the French Southern Territories of
today.
