//! The edits of the document, each of which has a reverse, for undo.

use crate::ids::{ColumnId, LevelCode, RowIndex};
use crate::table::ColumnValues;

/// A change to the document, as the undo history keeps it. Applying an
/// edit gives the edit that reverses it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Edit {
    /// Sets the code of some rows of a categorical column: an assignment to
    /// a population, a removal from one, or the reverse of either. Only the
    /// rows whose code changes are listed, in the order of the rows.
    SetCodes {
        column: ColumnId,
        changes: Vec<(RowIndex, Option<LevelCode>)>,
    },
    /// Replaces the values of a column: a change of role, or its reverse,
    /// which gives back the levels, their colours and the codes as they
    /// were.
    SetValues {
        column: ColumnId,
        values: ColumnValues,
    },
}
