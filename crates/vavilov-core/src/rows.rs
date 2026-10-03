//! A page of rows of the table, as the main window's table asks for it:
//! the names and the values of some columns in consecutive rows of those
//! the filter shows, as a message of rows (`docs/core.md`, section 5, "A
//! page of rows").

use crate::convert::usize_from;
use crate::error::CommandError;
use crate::ids::{ColumnId, Position, Revision, RowIndex};
use crate::message::{MessageKind, MessageWriter, PageValues};
use crate::session::Session;
use crate::table::{ColumnValues, Numbers};

/// What a window asks for: `count` rows from `first`, among those the
/// filter shows, with the values of `columns` in that order, made from its
/// copy at `based_on`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowsRequest {
    /// The position of the first row of the page among the rows shown.
    pub first: Position,
    /// The number of rows, which may be 0.
    pub count: u32,
    /// The columns whose values the page carries, by id, the first column
    /// not among them: the names come with every page.
    pub columns: Vec<ColumnId>,
    /// The revision of the window's copy when it asked.
    pub based_on: Revision,
}

impl Session {
    /// The page of rows a window asks for, as the bytes of a message of
    /// rows at the current revision. It changes nothing.
    ///
    /// # Errors
    ///
    /// `MadeBeforeLoad` for a request made before the current table was
    /// loaded; `NoProject`; `RowsOutOfRange` for a page that goes past the
    /// last row shown; `UnknownColumn` for an id the table does not have, the
    /// first column's included; or a `Defect`, for a column asked for
    /// twice among them.
    pub fn rows(&self, request: &RowsRequest) -> Result<Vec<u8>, CommandError> {
        self.check_based_on(request.based_on)?;
        let open = self.state.project.open()?;
        let table = &open.table;
        let shown = &open.interaction.shown;
        let num_shown = match &shown.rows {
            Some(rows) => u32::try_from(rows.len()).map_err(|_| CommandError::Defect {
                what: format!("{} rows shown", rows.len()),
            })?,
            None => table.num_rows(),
        };
        let out_of_range = CommandError::RowsOutOfRange {
            first: request.first,
            count: request.count,
            num_shown,
        };
        let first = request.first.get();
        let end = first
            .checked_add(request.count)
            .filter(|end| *end <= num_shown)
            .ok_or(out_of_range)?;
        let rows: Vec<RowIndex> = match &shown.rows {
            Some(rows) => rows
                .get(usize_from(first)..usize_from(end))
                .ok_or_else(|| CommandError::Defect {
                    what: format!("no rows shown {first} to {end}"),
                })?
                .to_vec(),
            None => (first..end).map(RowIndex::new).collect(),
        };
        self.page_message(request.first, &rows, &request.columns)
    }

    /// The row `row` of the table, with its name and the values of
    /// `columns` in that order, as the bytes of a message of rows at the
    /// current revision, for a window whose copy is at `based_on`: a page
    /// of one row, asked for by its row and not among the rows the filter
    /// shows, whose position is therefore 0. It changes nothing.
    ///
    /// # Errors
    ///
    /// `MadeBeforeLoad`; `NoProject`; `RowOutOfRange` for a row beyond the
    /// table; `UnknownColumn` for an id the table does not have, the first
    /// column's included; or a `Defect`, for a column asked for twice among
    /// them.
    pub fn row(
        &self,
        row: RowIndex,
        columns: &[ColumnId],
        based_on: Revision,
    ) -> Result<Vec<u8>, CommandError> {
        self.check_based_on(based_on)?;
        let num_rows = self.state.project.open()?.table.num_rows();
        if row.get() >= num_rows {
            return Err(CommandError::RowOutOfRange { row, num_rows });
        }
        self.page_message(Position::new(0), &[row], columns)
    }

    /// The message of rows of `rows`, the first at `first` among those
    /// shown, with the values of `columns`.
    fn page_message(
        &self,
        first: Position,
        rows: &[RowIndex],
        columns: &[ColumnId],
    ) -> Result<Vec<u8>, CommandError> {
        let open = self.state.project.open()?;
        let table = &open.table;
        // A window asks for each column once; a column asked for again
        // would let a short request make a page of any size.
        let mut asked = std::collections::HashSet::with_capacity(columns.len());
        if let Some(twice) = columns.iter().find(|id| !asked.insert(**id)) {
            return Err(CommandError::Defect {
                what: format!("a page that asks for column {twice} twice"),
            });
        }
        let columns = columns
            .iter()
            .map(|id| {
                table
                    .column(*id)
                    .ok_or(CommandError::UnknownColumn { column: *id })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut message = MessageWriter::new(MessageKind::Rows, self.state.revision, None);
        message.page(
            self.state.loaded_at,
            open.interaction.shown.at,
            table.names().revision(),
            first,
            rows,
        )?;
        message.names(&in_page(table.names().names(), rows)?)?;
        for column in columns {
            message.values(
                column.id(),
                column.revision(),
                page_values(column.values(), rows)?,
            )?;
        }
        Ok(message.finish())
    }
}

/// The values of a column in the rows of a page.
fn page_values<'a>(
    values: &'a ColumnValues,
    rows: &[RowIndex],
) -> Result<PageValues<'a>, CommandError> {
    if let Some(numbers) = values.numbers() {
        return Ok(match numbers {
            Numbers::Float(values) => PageValues::Float(copied(values, rows)?),
            Numbers::Integer(values) => PageValues::Integer(copied(values, rows)?),
        });
    }
    if let Some(categorical) = values.categorical() {
        return Ok(PageValues::Categorical(copied(categorical.codes(), rows)?));
    }
    match values {
        ColumnValues::Text(values) => Ok(PageValues::Text(
            in_page(values, rows)?
                .into_iter()
                .map(Option::as_ref)
                .collect(),
        )),
        ColumnValues::Number(_)
        | ColumnValues::Latitude(_)
        | ColumnValues::Longitude(_)
        | ColumnValues::Category(_)
        | ColumnValues::Country(_) => Err(CommandError::Defect {
            what: "a column neither of numbers, of codes nor of text".to_owned(),
        }),
    }
}

/// The values of the rows of a page, which were checked to be in the
/// table, so a column too short for them is a defect.
fn in_page<'a, T>(values: &'a [T], rows: &[RowIndex]) -> Result<Vec<&'a T>, CommandError> {
    rows.iter()
        .map(|row| {
            values
                .get(usize_from(row.get()))
                .ok_or_else(|| CommandError::Defect {
                    what: format!("a column of {} values has no row {row}", values.len()),
                })
        })
        .collect()
}

fn copied<T: Copy>(values: &[T], rows: &[RowIndex]) -> Result<Vec<T>, CommandError> {
    Ok(in_page(values, rows)?.into_iter().copied().collect())
}

#[cfg(test)]
mod tests;
