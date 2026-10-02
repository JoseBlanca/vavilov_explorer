# What Vavilov Explorer needs from table_io

2 October 2026. Vavilov Explorer is a desktop app, Tauri 2 with a Rust
backend, that shows one table of individuals in several linked views: a
3D scatter, a map, histograms and bar plots. Its design is in
`docs/design.md` of this repository. Section 7 there decides that the
owner's library `xlsx_rs` becomes `table_io`, a library that reads and
writes tables for both Vavilov Explorer and popnei_web. popnei_web is the
set of web applications of popnei, the owner's population genetics
library.

This document lists what Vavilov Explorer needs from `table_io`. It says
what is needed, not how `table_io` is built: the spec and the plan are
written in `table_io`'s repository, under `xlsx_rs`'s conventions (a spec
before the code, a plan before the work, and the owner's approval of
each), and the owner approves them there. What was decided with the owner along the
way, and what was set aside, is in section 8.

Three documents are the starting point:

- `xlsx_rs`: `docs/objectives.md`, `docs/architecture.md` and
  `docs/specs/read.md`, which read the first visible sheet of an xlsx
  file into cells;
- popnei_web: `docs/specs/worker/individuals.md`, the rules by which
  popnei_web reads a CSV, a TSV or an xlsx into a table today, written in
  TypeScript, and section 6 of its `docs/architecture.md`;
- this repository: `docs/design.md`, sections 5 to 8.

## 1. How Vavilov Explorer uses table_io

Vavilov Explorer never opens or saves a CSV or an xlsx. It imports one
into a new project and exports the table of a project to a new file. Its
own file, the project, is a zip of a Parquet file and a JSON file, and
`table_io` has no part in it.

- **Import.** The backend reads the bytes of the file the user chose and
  gives them to `table_io`. It gets back either the table, as typed
  columns, with a report of how the file was read, or a refusal that says
  why the file could not be read. It then builds its own table from the
  columns, giving each column an id of its own. A refusal loads nothing.
- **Changing a column's type later.** The user can change the type that
  was guessed, for example from text to numeric (`docs/design.md`,
  section 6). The conversion must read the values by the same rules the
  import used, so Vavilov Explorer calls `table_io` for it.
- **Export.** The backend gives `table_io` its columns and gets back the
  bytes of a CSV or an xlsx file.

Vavilov Explorer uses the Rust library crate natively, with every
format, and not the WebAssembly package. Its tables have tens of
thousands of rows.

## 2. What it takes from popnei_web's rules unchanged

These rules of popnei_web's `docs/specs/worker/individuals.md` are what
Vavilov Explorer needs too, and are the same in both apps:

- the bytes and the encoding: UTF-16 when the file starts with its byte
  order mark, UTF-8 when it starts with the byte order mark of UTF-8,
  otherwise UTF-8 when the bytes are valid UTF-8 and Windows-1252 when
  they are not. A file read as UTF-8, because of its byte order mark or
  because the caller set it, can still hold bytes that are not UTF-8;
  each becomes the replacement character, and the read reports the line
  of the first one. Windows-1252 decodes every byte, so it loses none. A
  file with a byte 0 that is not UTF-16 is refused as not text
  (`notText`), and a UTF-16 file that ends in the middle of a character
  as cut short (`cutShort`);
- finding the separator among the tab, `;` and `,`, and the decimal mark,
  the point or the comma;
- the lines, the quotes of RFC 4180, the spaces removed at the ends of a
  cell, the blank rows skipped;
- the header: the first row that is not blank, the empty cells at its end
  dropped, a column with values and no name refused, and two columns of
  one name refused (`duplicateColumn`);
- a row of the wrong length refused, with its line, its cells and the
  header's cells (`raggedRow`), and a quote never closed refused
  (`unclosedQuote`);
- the missing values: an empty cell, `NA` or `-`, exactly, and in an xlsx
  the seven errors of Excel as well, `#N/A`, `#DIV/0!`, `#NAME?`,
  `#NULL!`, `#NUM!`, `#REF!` and `#VALUE!`;
- what a number is: an optional sign, digits with at most one decimal
  mark, an optional exponent, finite, and no thousands separator;
- the first column names the individuals; Vavilov Explorer requires its
  header to be `IndividualID` and checks it itself, in its core
  (`design.md`, section 5), so table_io gives the header as written: its
  cells are text as written (`001` stays `001`, and `NA` is a name, not a
  missing value), a row with an empty first cell is refused
  (`emptyIndividual`), and a name in two rows is refused
  (`duplicateIndividual`), names being compared exactly;
- the sheet read in an xlsx is the first one that is not hidden, and a
  workbook whose first such sheet is empty is refused;
- the cells of an xlsx as `xlsx_rs` gives them, a date as text such as
  `2024-05-13`, and the refusals of an xlsx: not an xlsx, an old `.xls`,
  protected by a password, an empty first sheet, an error of Excel in the
  header, an error calamine does not know, a sheet too large;
- the order in which the refusals are reported when a file has several
  problems, given at the end of "The rows and the cells" in popnei_web's
  spec;
- a refusal is a value, never a panic, and carries what the words of its
  message need: the line, or the row and the column as Excel names them,
  the separator used, the names involved.

Each app writes the words of the messages in its own language and voice.
`table_io` gives the kind of each refusal and its data.

## 3. Where Vavilov Explorer differs

Some rules of popnei_web come from what popnei_web does with the table,
and do not hold for Vavilov Explorer:

- **The types of the columns.** popnei_web gives each column one of
  identifier, binary, continuous and categorical. In Vavilov Explorer the
  first column is text, always, and every other column gets one of
  numeric, integer, text, boolean and categorical:

  | type | when, as proposed for Vavilov Explorer |
  |---|---|
  | integer | every value is a whole number within the range of a 64-bit integer: in a CSV, written without a decimal mark or an exponent; in an xlsx, a number cell whose value is whole, such as 3, or a text cell written so |
  | numeric | every value is a number, and the column is not integer |
  | boolean | every value is `TRUE` or `FALSE` in any case, or a boolean cell of an xlsx |
  | categorical | some value appears in more than one row, and the column has fewer than 20 distinct values; missing cells are not counted |
  | text | anything else: every value different, or 20 distinct values or more |

  A column with no value, every cell missing, is categorical. A
  categorical column gives its levels in alphabetical order and, for each
  row, the level it holds or missing. A classification of 20 populations
  or more is guessed text, and the user changes its type to categorical.
  These rules are the owner's. Not boolean: `yes`/`no`, `1`/`0`, and the
  words of Excel in other languages, such as `VERDADERO` and `FALSO`,
  which a Spanish Excel writes into a CSV.
- **Two values are not a type of their own.** popnei_web's binary type,
  with the value coded 1 chosen from known pairs such as `case` and
  `control`, is used by association analyses. Vavilov Explorer has none:
  `case` and `control` make a categorical column.
- **The warning for a column of few whole numbers**, popnei_web's
  `fewWholeLevels`, which says the values may be codes such as numbered
  populations, would be useful in Vavilov Explorer too, where such a
  column is guessed integer and the user would change it to categorical.
  popnei_web gives it to a column of at most 20 distinct whole numbers.
- **The limits.** popnei_web refuses a file of more than 20 MB and a sheet
  of more than 2,000,000 cells. Vavilov Explorer runs natively with more
  memory and would set larger limits, which have not been chosen. So the
  limits are given by the caller with each read.
- **A VCF picked by mistake**, refused as `variantsFile` in popnei_web,
  is a case Vavilov Explorer does not meet: its users have no variants
  file. The check does no harm to Vavilov Explorer if it stays in
  `table_io`.

What the two apps share is reading the bytes into cells and reading each
cell as a value, by sections 2 and 5 here, and the rules of the first
column. What they do not share is which type the other columns get. How
`table_io` separates the two, for example by giving the facts of each
column (whether every value is a number, a whole number or a boolean,
how many distinct values it has) and leaving the choice of the type to
each app, or by one set of types with the rules of each app as options,
is for its spec to decide.

## 4. What an import gives

For a file read:

- the columns, in the order of the file, each with its name, its number
  in the file counted from 1 (for an xlsx, its column in the sheet, from
  which the app writes Excel's letter), its guessed type,
  and its values in that type, with the missing cells marked apart from
  the values: 64-bit floats for numeric, 64-bit integers for integer,
  booleans, texts, and for categorical the levels and one code per row;
- how it was read: the encoding, the separator and the decimal mark of a
  CSV, and the line of the first character that could not be decoded, so
  that the user can be shown "Read as Windows-1252, separator `;`,
  decimal comma" and a warning that names the line where a character
  could not be decoded;
- for an xlsx, the name of the sheet read.

The encoding, the separator and the decimal mark can each be set by the
caller instead of found, as popnei_web's options `encoding`, `separator`
and `decimal` are, so that a user can correct a wrong guess and import
again.

For a file not read: the refusal, with its kind and data, and nothing
else. No part of a table is returned with a refusal.

## 5. Reading a value later, by the same rules

To change a column's type after the import, Vavilov Explorer needs the
rules of section 2 as functions on values:

- whether a text is missing;
- the number, the whole number or the boolean a text holds, with a given
  decimal mark, or that it holds none;
- for a column of texts and a target type, whether every value converts,
  and when not, how many values fail and the first of them with its row,
  so that the user reads "12 values are not numbers, such as 'n.d.' in
  row 40".

The decimal mark of a later conversion is the one the import used, which
Vavilov Explorer keeps with the project.

## 6. Export

- **CSV.** Vavilov Explorer gives the columns, with their names and
  types, and the choices of the user: the separator, the decimal mark,
  the encoding (UTF-8 with or without the byte order mark, or
  Windows-1252), and the text of a missing value (empty or `NA`).
  Floats are written in the shortest form that reads back as the same
  float. Cells are quoted by RFC 4180 when they hold the separator, a
  quote or a line break, so a comma as both the separator and the decimal
  mark is accepted, with every such number quoted. A text that cannot be written in Windows-1252 is
  a refusal that names the column and the row, never a replaced
  character.
- **A text that would read back as missing.** A text value that is
  empty, `NA` or `-` would be read back as missing by the import. The
  export refuses it and names the column and the row, whatever the text
  of a missing value is.
- **xlsx.** One sheet, the names in the first row, a number as a number
  cell, a boolean as a boolean cell, text and categorical values as text
  cells, a missing value as an empty cell. What the user exports goes to
  a new file, so nothing of another workbook has to be kept.
- **The round trip.** A table exported and imported again gives the same
  names, the same values and the same types, except where the rule for
  categorical and text decides otherwise: a categorical column with no
  repeated value or with 20 levels or more comes back as text, and a text
  column with a repeated value and fewer than 20 distinct values comes
  back as categorical.
  The tests check the round trip, for both formats and for every choice
  of the CSV.

## 7. Other requirements

- **No panic** on any input, as `xlsx_rs` already holds, since a panic
  in the Tauri backend ends the app.
- **Each format a cargo feature**, the CSV and the xlsx apart, so that
  popnei_web can build a WebAssembly package without the xlsx reader,
  which is almost all of the size of today's package. The reading of
  values and the guessing of types are not behind a feature.
- **Speed.** A proposed target, to be confirmed: importing a CSV of
  100,000 rows and 50 columns in under one second on the owner's Mac, in
  a release build, the measurement recording the model of the Mac.
  Nothing has been measured.

Not needed by Vavilov Explorer: other sheets than the one read, the
formats, formulas or comments of a workbook, writing more than one
sheet, `.xls` or `.ods`, Parquet, and a type for dates.

## 8. Decided with the owner, and set aside

- Vavilov Explorer depends on `table_io` by git, at a pinned revision.
- The defaults of the export, for example a semicolon and a decimal comma
  for a user whose Excel is in Spanish, belong to the export dialog of
  Vavilov Explorer. `table_io` accepts every combination of section 6.

Set aside by the owner for now: popnei_web reads a CSV in TypeScript
today and downloads `xlsx_rs`'s WebAssembly package only for an xlsx, so
a user with a CSV never downloads it. If popnei_web moves its CSV reading
into `table_io`, every user downloads the CSV build, whose size has not
been measured.
