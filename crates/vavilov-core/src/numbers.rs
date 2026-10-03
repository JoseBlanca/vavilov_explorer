//! A numeric column as a window draws it, whole, as raw bytes: the axes of
//! a 3D scatter (`docs/design.md`, section 4).

use crate::error::CommandError;
use crate::ids::{ColumnId, Revision};
use crate::message::{MessageKind, MessageWriter};
use crate::session::Session;

impl Session {
    /// The values of the numeric column `column`, of any of the roles of a
    /// number, as the bytes of a message of numbers at the current
    /// revision, for a window whose copy is at `based_on`. It changes
    /// nothing. The column's revision in the message tells the window
    /// whether the values are those of its copy.
    ///
    /// # Errors
    ///
    /// `MadeBeforeLoad` for a request made before the current table was
    /// loaded; `NoProject`; `UnknownColumn` for an id the table does not
    /// have, the first column's included; `NotNumber` for a category or
    /// text; or a `Defect`.
    pub fn numbers(&self, column: ColumnId, based_on: Revision) -> Result<Vec<u8>, CommandError> {
        self.check_based_on(based_on)?;
        let open = self.state.project.open()?;
        let found = open
            .table
            .column(column)
            .ok_or(CommandError::UnknownColumn { column })?;
        let numbers = found
            .values()
            .numbers()
            .ok_or(CommandError::NotNumber { column })?;
        let mut message = MessageWriter::new(MessageKind::Numbers, self.state.revision, None);
        message.numbers(column, found.revision(), numbers)?;
        Ok(message.finish())
    }
}

#[cfg(test)]
mod tests;
