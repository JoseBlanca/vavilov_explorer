//! The export of the table to the bytes of a new CSV or xlsx, written by
//! `table_io`, which refuses a value that would not read back as itself
//! (`docs/design.md`, section 7). A category is written as its values, in
//! its storage type, and a category of countries as their codes; the first
//! column is headed `IndividualID`. With `import.rs`, the only module that
//! names `table_io`.

use crate::error::{CommandError, ExportRefusal};
use crate::formats::{CsvEncoding, DecimalMark, ExportFormat, MissingText, Separator};
use crate::ids::Revision;
use crate::session::Session;
use crate::table::{INDIVIDUAL_ID, Stored, Table};

impl Session {
    /// A copy of the table, for an export made from a window's copy at
    /// `based_on`, so that it is written once the session's lock is
    /// released.
    ///
    /// # Errors
    ///
    /// `MadeBeforeLoad` for a request made before the table was loaded,
    /// `NoProject`, or a `Defect` for a revision still to come.
    pub fn table_to_export(&self, based_on: Revision) -> Result<Table, CommandError> {
        self.check_based_on(based_on)?;
        self.table().cloned().ok_or(CommandError::NoProject)
    }
}

/// The bytes of a file of `format` holding `table`.
///
/// # Errors
///
/// `ExportRefused` with the cell or the table that would not read back as
/// itself, named by its column and its individual; a `Defect` for a
/// refusal the core's table makes impossible, or a failure of the writer.
pub fn export_table(table: &Table, format: ExportFormat) -> Result<Vec<u8>, CommandError> {
    let names = table_io::NameColumn {
        header: INDIVIDUAL_ID.to_owned(),
        number: 1,
        names: table.names().names().to_vec(),
    };
    let mut columns = Vec::with_capacity(table.columns().len());
    // Column 1 is the names', and the others follow, as table_io numbers
    // the places of a refusal.
    for (number, column) in (2..=u32::MAX).zip(table.columns()) {
        columns.push(table_io::Column {
            name: column.name().to_owned(),
            number,
            values: values_of(column.values().to_stored()?),
        });
    }
    let format = match format {
        ExportFormat::Csv { choices } => table_io::ExportFormat::Csv(table_io::CsvExport {
            separator: match choices.separator {
                Separator::Tab => table_io::Separator::Tab,
                Separator::Semicolon => table_io::Separator::Semicolon,
                Separator::Comma => table_io::Separator::Comma,
            },
            decimal: match choices.decimal {
                DecimalMark::Point => table_io::DecimalMark::Point,
                DecimalMark::Comma => table_io::DecimalMark::Comma,
            },
            encoding: match choices.encoding {
                CsvEncoding::Utf8 => table_io::CsvEncoding::Utf8,
                CsvEncoding::Utf8WithMark => table_io::CsvEncoding::Utf8WithMark,
                CsvEncoding::Windows1252 => table_io::CsvEncoding::Windows1252,
            },
            missing: match choices.missing {
                MissingText::Empty => table_io::MissingText::Empty,
                MissingText::Na => table_io::MissingText::Na,
            },
        }),
        ExportFormat::Xlsx => table_io::ExportFormat::Xlsx,
    };
    table_io::export_table(&names, &columns, &format).map_err(|error| match error {
        table_io::ExportError::Refused(refusal) => refusal_of(table, refusal),
        table_io::ExportError::Failed(message) => CommandError::Defect {
            what: format!("the writer of the export failed: {message}"),
        },
    })
}

fn values_of(stored: Stored) -> table_io::ColumnValues {
    match stored {
        Stored::Integer(values) => table_io::ColumnValues::Integer(values),
        Stored::Float(values) => table_io::ColumnValues::Float(values),
        Stored::Boolean(values) => table_io::ColumnValues::Boolean(values),
        Stored::Text(values) => table_io::ColumnValues::Text(values),
    }
}

/// The core's words for a refusal of `table_io`, its places named by the
/// column and the individual; a `Defect` for one the core's table makes
/// impossible: names that are empty or repeated, a column of another
/// length, a number not finite, a format not built.
fn refusal_of(table: &Table, refusal: table_io::ExportRefusal) -> CommandError {
    use table_io::ExportRefusal as R;
    let defect = |refusal: &R| CommandError::Defect {
        what: format!("an export refused as the table makes impossible: {refusal:?}"),
    };
    let named = |place: table_io::CellPlace| -> Result<(String, Option<String>), CommandError> {
        let column = match place.column.checked_sub(2) {
            None => INDIVIDUAL_ID.to_owned(),
            Some(index) => table
                .columns()
                .get(crate::convert::usize_from(index))
                .map(|column| column.name().to_owned())
                .ok_or_else(|| CommandError::Defect {
                    what: format!(
                        "an export refused at a column {} not in the table",
                        place.column
                    ),
                })?,
        };
        let individual = match place.row.checked_sub(1) {
            None => None,
            Some(index) => Some(
                table
                    .names()
                    .names()
                    .get(crate::convert::usize_from(index))
                    .cloned()
                    .ok_or_else(|| CommandError::Defect {
                        what: format!("an export refused at a row {} not in the table", place.row),
                    })?,
            ),
        };
        Ok((column, individual))
    };
    let of_a_value = |place| -> Result<(String, String), CommandError> {
        match named(place)? {
            (column, Some(individual)) => Ok((column, individual)),
            (column, None) => Err(CommandError::Defect {
                what: format!("an export refused a value in the header, column {column:?}"),
            }),
        }
    };
    let refusal = match &refusal {
        R::NoIndividual => Ok(ExportRefusal::NoIndividual),
        R::ReadsAsMissing { place } => {
            of_a_value(*place).map(|(column_name, individual)| ExportRefusal::ReadsAsMissing {
                column_name,
                individual,
            })
        }
        R::ErrorAsName { place } => {
            named(*place).map(|(column_name, _)| ExportRefusal::ErrorAsName { column_name })
        }
        R::SpacesAtEnds { place } => {
            named(*place).map(|(column_name, individual)| ExportRefusal::SpacesAtEnds {
                column_name,
                individual,
            })
        }
        R::IntegerTooLarge { place } => {
            of_a_value(*place).map(|(column_name, individual)| ExportRefusal::IntegerTooLarge {
                column_name,
                individual,
            })
        }
        R::CannotCarry { place, character } => {
            named(*place).map(|(column_name, individual)| ExportRefusal::CannotCarry {
                column_name,
                individual,
                character: *character,
            })
        }
        R::TextTooLong { place, length } => {
            named(*place).map(|(column_name, individual)| ExportRefusal::TextTooLong {
                column_name,
                individual,
                length: *length,
            })
        }
        R::TooLargeForSheet { rows, columns } => Ok(ExportRefusal::TooLargeForSheet {
            rows: *rows,
            columns: *columns,
        }),
        R::ReadsAsVariantsFile => Ok(ExportRefusal::ReadsAsVariantsFile),
        R::FormatNotBuilt
        | R::WrongLength { .. }
        | R::EmptyName { .. }
        | R::DuplicateName { .. }
        | R::EmptyIndividual { .. }
        | R::DuplicateIndividual { .. }
        | R::NotFinite { .. } => Err(defect(&refusal)),
    };
    match refusal {
        Ok(refusal) => CommandError::ExportRefused { refusal },
        Err(defect) => defect,
    }
}

#[cfg(test)]
mod tests;
