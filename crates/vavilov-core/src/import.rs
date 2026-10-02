//! The import of a table from the bytes of a CSV, a TSV or an xlsx: the
//! file read by `table_io`, its refusals turned into the core's, the first
//! column checked as `IndividualID`, and the role of each other column
//! guessed (`docs/design.md`, sections 5 to 7). With `export.rs`, the only
//! module that names `table_io`.

use std::collections::HashSet;

use crate::error::{CommandError, ImportRefusal};
use crate::formats::{FileFormat, Separator};
use crate::ids::ColumnId;
use crate::table::{
    Column, ColumnValues, LATITUDE, LONGITUDE, NewColumn, Numbers, Role, Stored, Table,
    check_range, is_individual_id,
};

/// The largest file the import reads, 20 MB, popnei_web's limit (decided
/// by the owner on 2 October 2026, `docs/design.md`, section 7).
pub const MAX_IMPORT_BYTES: u64 = 20_000_000;

/// The most cells of the values of an xlsx the import reads, 2,000,000,
/// popnei_web's limit (decided the same day).
pub const MAX_IMPORT_CELLS: u32 = 2_000_000;

/// The most distinct values of a column of text that the import guesses
/// a category; one of more is text (`docs/design.md`, section 6).
pub const MAX_GUESSED_LEVELS: usize = 20;

/// A table read from a file, and what the user is told of how it was read.
#[derive(Clone, Debug, PartialEq)]
pub struct Imported {
    /// The table, every column with its guessed role.
    pub table: Table,
    /// The column the session starts with as the active classification:
    /// the first category, of countries or not, or `None` when the table
    /// has none (decided by the owner on 2 October 2026).
    pub active_classification: Option<ColumnId>,
    /// The line of the first character of a text file that could not be
    /// decoded, and stands as U+FFFD, from 1; `None` when there is none,
    /// and for an xlsx.
    pub undecoded_line: Option<u32>,
}

/// The table of the file `bytes`, named `file_name` for the messages.
///
/// # Errors
///
/// `ImportRefused` with the refusal of `table_io`, of the first column's
/// header, or of a column named as the first; `ImportUnreadable` for a
/// damaged xlsx; a `Defect` for a table the core refuses after
/// `table_io` gave it, which the two make impossible.
pub fn import_table(file_name: &str, bytes: &[u8]) -> Result<Imported, CommandError> {
    let options = table_io::ImportOptions {
        max_bytes: MAX_IMPORT_BYTES,
        max_cells: MAX_IMPORT_CELLS,
        text: table_io::TextOptions::default(),
    };
    let read = table_io::import_table(bytes, &options).map_err(|error| match error {
        table_io::ImportError::Refused { format, refusal } => {
            match refusal_of(format_of(format), refusal) {
                Ok(refusal) => refused(file_name, refusal),
                Err(defect) => defect,
            }
        }
        table_io::ImportError::Unreadable(message) => CommandError::ImportUnreadable {
            file_name: file_name.to_owned(),
            message,
        },
    })?;
    let (format, undecoded_line) = match &read.read {
        table_io::HowRead::Text(text) => (FileFormat::Text, text.undecoded_line),
        table_io::HowRead::Xlsx { .. } => (FileFormat::Xlsx, None),
    };
    if !is_individual_id(&read.names.header) {
        return Err(refused(
            file_name,
            ImportRefusal::NotIndividualId {
                header: read.names.header,
            },
        ));
    }
    if let Some(column) = read
        .columns
        .iter()
        .find(|column| is_individual_id(&column.name))
    {
        return Err(refused(
            file_name,
            ImportRefusal::NamedIndividualId {
                format,
                column: column.number,
            },
        ));
    }
    // The ids are those Table::new gives, 1 and on in the order of the
    // columns, which a refusal of a sub-role would name.
    let mut columns = Vec::with_capacity(read.columns.len());
    for (id, column) in (1..=u32::MAX).zip(read.columns) {
        let stored = stored_of(column.values);
        let role = guessed_role(&column.name, &stored);
        let values = ColumnValues::from_stored(stored, role, ColumnId::new(id), &column.name)
            .map_err(|error| defect(&error))?;
        columns.push(NewColumn {
            name: column.name,
            values,
        });
    }
    let table =
        Table::new(read.names.header, read.names.names, columns).map_err(|error| defect(&error))?;
    let active_classification = table
        .columns()
        .iter()
        .find(|column| column.values().role().is_categorical())
        .map(Column::id);
    Ok(Imported {
        table,
        active_classification,
        undecoded_line,
    })
}

fn refused(file_name: &str, refusal: ImportRefusal) -> CommandError {
    CommandError::ImportRefused {
        file_name: file_name.to_owned(),
        refusal,
    }
}

/// A refusal of the core of a table `table_io` gave, which the two make
/// impossible: a role guessed that the values do not take, a table of
/// more rows than a file of 20 MB holds.
fn defect(error: &CommandError) -> CommandError {
    CommandError::Defect {
        what: format!("an imported table the core refused: {error}"),
    }
}

/// The role the import gives a column (`docs/design.md`, section 6): a
/// number, or a latitude or a longitude when its header says so and its
/// values fit; a category for yes or no and for text of 1 to
/// [`MAX_GUESSED_LEVELS`] distinct values; text for the rest, a column
/// with no value among them (decided by the owner on 2 October 2026).
fn guessed_role(name: &str, stored: &Stored) -> Role {
    let numbers = match stored {
        Stored::Integer(values) => Numbers::Integer(values.clone()),
        Stored::Float(values) => Numbers::Float(values.clone()),
        Stored::Boolean(_) => return Role::Category,
        Stored::Text(values) => {
            let distinct: HashSet<&str> = values.iter().flatten().map(String::as_str).collect();
            return if (1..=MAX_GUESSED_LEVELS).contains(&distinct.len()) {
                Role::Category
            } else {
                Role::Text
            };
        }
    };
    let fits = |range: &std::ops::RangeInclusive<f64>| {
        check_range(&numbers, range, ColumnId::new(0), Role::Number).is_ok()
    };
    match name.trim().to_lowercase().as_str() {
        "lat" | "latitude" if fits(&LATITUDE) => Role::Latitude,
        "lon" | "long" | "longitude" if fits(&LONGITUDE) => Role::Longitude,
        _ => Role::Number,
    }
}

fn stored_of(values: table_io::ColumnValues) -> Stored {
    match values {
        table_io::ColumnValues::Integer(values) => Stored::Integer(values),
        table_io::ColumnValues::Float(values) => Stored::Float(values),
        table_io::ColumnValues::Boolean(values) => Stored::Boolean(values),
        table_io::ColumnValues::Text(values) => Stored::Text(values),
    }
}

const fn format_of(format: table_io::Format) -> FileFormat {
    match format {
        table_io::Format::Text => FileFormat::Text,
        table_io::Format::Xlsx => FileFormat::Xlsx,
    }
}

const fn separator_of(separator: table_io::Separator) -> Separator {
    match separator {
        table_io::Separator::Tab => Separator::Tab,
        table_io::Separator::Semicolon => Separator::Semicolon,
        table_io::Separator::Comma => Separator::Comma,
    }
}

/// The core's words for a refusal of `table_io`, or a `Defect` for a
/// format not built, since the app builds both.
fn refusal_of(
    format: FileFormat,
    refusal: table_io::Refusal,
) -> Result<ImportRefusal, CommandError> {
    use table_io::Refusal as R;
    Ok(match refusal {
        R::TooLarge { size, max_bytes } => ImportRefusal::TooLarge { size, max_bytes },
        R::FormatNotBuilt => {
            return Err(CommandError::Defect {
                what: format!("table_io built without the format {format:?}"),
            });
        }
        R::OldExcel => ImportRefusal::OldExcel,
        R::Encrypted => ImportRefusal::Encrypted,
        R::NotWorkbook => ImportRefusal::NotWorkbook,
        R::EmptySheet { sheet } => ImportRefusal::EmptySheet { sheet },
        R::CellError { error } => ImportRefusal::CellError { error },
        R::SheetTooLarge {
            sheet,
            first_row,
            first_column,
            num_rows,
            num_columns,
        } => ImportRefusal::SheetTooLarge {
            sheet,
            first_row,
            first_column,
            num_rows,
            num_columns,
            max_cells: MAX_IMPORT_CELLS,
        },
        R::CutShort => ImportRefusal::CutShort,
        R::NotText => ImportRefusal::NotText,
        R::VariantsFile => ImportRefusal::VariantsFile,
        R::UnclosedQuote { line, separator } => ImportRefusal::UnclosedQuote {
            line,
            separator: separator_of(separator),
        },
        R::HeaderError { row, column, error } => ImportRefusal::HeaderError { row, column, error },
        R::Empty => ImportRefusal::Empty,
        R::UnnamedColumn { column } => ImportRefusal::UnnamedColumn { format, column },
        R::RaggedRow {
            line,
            expected,
            found,
            separator,
        } => ImportRefusal::RaggedRow {
            line,
            expected,
            found,
            separator: separator_of(separator),
        },
        R::DuplicateColumn {
            name,
            first_column,
            second_column,
        } => ImportRefusal::DuplicateColumn {
            format,
            name,
            first_column,
            second_column,
        },
        R::EmptyIndividual { row } => ImportRefusal::EmptyIndividual { format, row },
        R::DuplicateIndividual {
            name,
            first_row,
            second_row,
        } => ImportRefusal::DuplicateIndividual {
            format,
            name,
            first_row,
            second_row,
        },
    })
}

#[cfg(test)]
mod tests;
