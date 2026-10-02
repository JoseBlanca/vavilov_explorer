//! A page of rows of the table, as the main window's table asks for it:
//! the names and the values of some columns in consecutive rows, as a
//! message of rows (`docs/core.md`, section 5, "A page of rows").

use std::ops::Range;

use crate::convert::usize_from;
use crate::error::CommandError;
use crate::ids::{ColumnId, Revision, RowIndex};
use crate::message::{MessageKind, MessageWriter, PageValues};
use crate::session::Session;
use crate::table::{ColumnValues, Numbers};

/// What a window asks for: `count` rows from `first`, with the values of
/// `columns` in that order, made from its copy at `based_on`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowsRequest {
    /// The first row of the page.
    pub first: RowIndex,
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
    /// last row; `UnknownColumn` for an id the table does not have, the
    /// first column's included; or a `Defect`, for a column asked for
    /// twice among them.
    pub fn rows(&self, request: &RowsRequest) -> Result<Vec<u8>, CommandError> {
        self.check_based_on(request.based_on)?;
        let table = &self.state.project.open()?.table;
        let num_rows = table.num_rows();
        let out_of_range = CommandError::RowsOutOfRange {
            first: request.first.get(),
            count: request.count,
            num_rows,
        };
        let end = request
            .first
            .get()
            .checked_add(request.count)
            .filter(|end| *end <= num_rows)
            .ok_or(out_of_range)?;
        let rows = usize_from(request.first.get())..usize_from(end);
        // A window asks for each column once; a column asked for again
        // would let a short request make a page of any size.
        let mut asked = std::collections::HashSet::with_capacity(request.columns.len());
        if let Some(twice) = request.columns.iter().find(|id| !asked.insert(**id)) {
            return Err(CommandError::Defect {
                what: format!("a page that asks for column {twice} twice"),
            });
        }
        let columns = request
            .columns
            .iter()
            .map(|id| {
                table
                    .column(*id)
                    .ok_or(CommandError::UnknownColumn { column: *id })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut message = MessageWriter::new(MessageKind::Rows, self.state.revision, None);
        message.page(self.state.loaded_at, request.first, request.count)?;
        message.names(in_page(table.names().names(), &rows)?)?;
        for column in columns {
            message.values(
                column.id(),
                column.revision(),
                page_values(column.values(), &rows)?,
            )?;
        }
        Ok(message.finish())
    }
}

/// The values of a column in the rows of a page.
fn page_values<'a>(
    values: &'a ColumnValues,
    rows: &Range<usize>,
) -> Result<PageValues<'a>, CommandError> {
    if let Some(numbers) = values.numbers() {
        return Ok(match numbers {
            Numbers::Float(values) => PageValues::Float(in_page(values, rows)?),
            Numbers::Integer(values) => PageValues::Integer(in_page(values, rows)?),
        });
    }
    if let Some(categorical) = values.categorical() {
        return Ok(PageValues::Categorical(in_page(categorical.codes(), rows)?));
    }
    match values {
        ColumnValues::Text(values) => Ok(PageValues::Text(in_page(values, rows)?)),
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
fn in_page<'a, T>(values: &'a [T], rows: &Range<usize>) -> Result<&'a [T], CommandError> {
    values
        .get(rows.clone())
        .ok_or_else(|| CommandError::Defect {
            what: format!(
                "a column of {} values has no rows {} to {}",
                values.len(),
                rows.start,
                rows.end
            ),
        })
}

#[cfg(test)]
mod tests;
