//! Why a file the user chose was not imported or exported, with what the
//! words of the message need, as a window receives them inside a
//! `CommandError` (`docs/core.md`, section 6). A line is a line of a text
//! file, from 1, and a column of a text file its place in the row, from 1;
//! a row and a column of an xlsx are those of its sheet, column A being 1.

use serde::Serialize;

use crate::formats::{FileFormat, Separator};

/// What the file system refused, for the words of the message.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IoFailure {
    /// No file of that name, moved or deleted since it was chosen.
    NotFound,
    /// The user may not read or write it there.
    PermissionDenied,
    /// Anything else, which the message of the system says.
    Other,
}

/// Why a file was not imported. The first refusals are `table_io`'s
/// (its `docs/specs/import.md`, "The refusals"), the last two the core's
/// own, of the first column (`docs/design.md`, section 5).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportRefusal {
    /// A file larger than the import takes.
    TooLarge {
        /// Its size, in bytes.
        size: u64,
        /// The largest the import takes, in bytes.
        max_bytes: u64,
    },
    /// A workbook of Excel 97–2003, an `.xls`.
    OldExcel,
    /// An xlsx saved with a password to open it.
    Encrypted,
    /// A zip that holds no workbook, such as a `.docx`.
    NotWorkbook,
    /// An xlsx whose first visible sheet holds no value.
    EmptySheet {
        /// The name of the sheet.
        sheet: String,
    },
    /// An xlsx with a cell holding an error Excel's reader does not know.
    CellError {
        /// The text of the error, such as `#GETTING_DATA`.
        error: String,
    },
    /// An xlsx whose values fill more cells than the import takes.
    SheetTooLarge {
        /// The name of the sheet.
        sheet: String,
        /// The first row of its values.
        first_row: u32,
        /// The first column of its values.
        first_column: u32,
        /// The rows reached when the limit was passed.
        num_rows: u32,
        /// The columns reached when the limit was passed.
        num_columns: u32,
        /// The most cells the import takes, `MAX_IMPORT_CELLS`.
        max_cells: u32,
    },
    /// A text file in UTF-16 that ends in the middle of a character.
    CutShort,
    /// A file that is not text, as a binary file is not.
    NotText,
    /// A file of variants, a VCF.
    VariantsFile,
    /// A text file with a quote never closed.
    UnclosedQuote {
        /// The line where the quoted cell starts.
        line: u32,
        /// The separator the file was split with.
        separator: Separator,
    },
    /// A cell of the header of an xlsx holding an error of Excel.
    HeaderError {
        /// The row of the sheet.
        row: u32,
        /// The column of the sheet.
        column: u32,
        /// The error, such as `#VALUE!`.
        error: String,
    },
    /// A file with no row below its header.
    Empty,
    /// A column with no name and a value in some row.
    UnnamedColumn {
        /// Whether `column` is a place in a line or a column of a sheet.
        format: FileFormat,
        /// The column.
        column: u32,
    },
    /// A row of a text file with another number of cells than the header.
    RaggedRow {
        /// The line where the row starts.
        line: u32,
        /// The cells of the header.
        expected: u32,
        /// The cells of the row.
        found: u32,
        /// The separator the file was split with.
        separator: Separator,
    },
    /// Two columns of one name.
    DuplicateColumn {
        /// Whether the columns are places in a line or columns of a sheet.
        format: FileFormat,
        /// The name.
        name: String,
        /// The column of its first use.
        first_column: u32,
        /// The column that repeats it.
        second_column: u32,
    },
    /// A row whose first cell, the name of its individual, is empty.
    EmptyIndividual {
        /// Whether `row` is a line or a row of a sheet.
        format: FileFormat,
        /// The line or the row.
        row: u32,
    },
    /// An individual named in two rows.
    DuplicateIndividual {
        /// Whether the rows are lines or rows of a sheet.
        format: FileFormat,
        /// The name.
        name: String,
        /// The line or row of its first row.
        first_row: u32,
        /// The line or row that repeats it.
        second_row: u32,
    },
    /// Two individuals whose IDs are one text once both are in Unicode's
    /// composed form, NFC, such as `José` written with its accent as part of
    /// the `é` and as a separate character after the `e`.
    IndividualWrittenTwoWays {
        /// The ID, in the composed form.
        name: String,
    },
    /// Two columns whose names are one text once both are in Unicode's
    /// composed form, NFC.
    ColumnWrittenTwoWays {
        /// The name, in the composed form.
        name: String,
    },
    /// A first column whose header is not `IndividualID`, as
    /// `is_individual_id` compares them.
    NotIndividualId {
        /// The header as the file wrote it.
        header: String,
    },
    /// A column other than the first named `IndividualID`, the name the
    /// app gives the first.
    NamedIndividualId {
        /// Whether `column` is a place in a line or a column of a sheet.
        format: FileFormat,
        /// The column.
        column: u32,
    },
}

/// Why the table was not exported: a value or a name the file would not
/// read back as itself (`table_io`'s `docs/specs/export.md`, "The
/// refusals"). A place names the column by its name, `IndividualID` for
/// the first, and the row by the name of its individual, `None` for the
/// header.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExportRefusal {
    /// A table of no row, whose file would read back as empty.
    NoIndividual,
    /// A text that reads back as missing, `NA` or `-`, or in an xlsx an
    /// error of Excel such as `#N/A`.
    ReadsAsMissing {
        /// The column.
        column_name: String,
        /// The individual.
        individual: String,
    },
    /// A name of a column that is an error of Excel, in an xlsx.
    ErrorAsName {
        /// The column so named.
        column_name: String,
    },
    /// A text with spaces at its ends, which an xlsx does not keep.
    SpacesAtEnds {
        /// The column.
        column_name: String,
        /// The individual, or `None` for the name of the column.
        individual: Option<String>,
    },
    /// A whole number beyond ±2^53, which a number of Excel does not hold.
    IntegerTooLarge {
        /// The column.
        column_name: String,
        /// The individual.
        individual: String,
    },
    /// A character the file cannot carry, such as one Windows-1252 does
    /// not have.
    CannotCarry {
        /// The column.
        column_name: String,
        /// The individual, or `None` for the name of the column.
        individual: Option<String>,
        /// The character.
        character: char,
    },
    /// A text longer than a cell of Excel holds, 32,767 units of UTF-16.
    TextTooLong {
        /// The column.
        column_name: String,
        /// The individual, or `None` for the name of the column.
        individual: Option<String>,
        /// Its length, in units of UTF-16.
        length: u32,
    },
    /// A table larger than a sheet of Excel.
    TooLargeForSheet {
        /// Its rows, the header's among them.
        rows: u32,
        /// Its columns, the first among them.
        columns: u32,
    },
    /// A CSV whose header would read back as a file of variants.
    ReadsAsVariantsFile,
}
