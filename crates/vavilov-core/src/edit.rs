//! The edits of the document, each of which has a reverse, for undo.

use crate::ids::{ColumnId, LevelCode, RowIndex};
use crate::table::ColumnValues;

/// A change to the document, as the undo history keeps it. Applying an
/// edit gives the edit that reverses it.
#[derive(Clone, Debug, PartialEq)]
#[expect(
    clippy::enum_variant_names,
    reason = "each edit sets one part of the document, and docs/core.md names them so"
)]
pub(crate) enum Edit {
    /// Sets the code of some rows of a categorical column: an assignment to
    /// a population, a removal from one, or the reverse of either. Only the
    /// rows whose code changes are listed, in the order of the rows.
    SetCodes {
        column: ColumnId,
        changes: Vec<(RowIndex, Option<LevelCode>)>,
    },
    /// Sets the values of some cells of a column of numbers or text: an
    /// edit in the table, or its reverse. Only the rows whose value
    /// changes are listed, in the order of the rows, each value of the
    /// column's storage type.
    SetCells {
        column: ColumnId,
        changes: Vec<(RowIndex, CellValue)>,
    },
    /// Sets the names of some individuals, the first column: an edit in
    /// the table, or its reverse. Only the rows whose name changes are
    /// listed, in the order of the rows.
    SetNames { changes: Vec<(RowIndex, String)> },
    /// Replaces the values of a column: a change of role, or its reverse,
    /// which gives back the levels, their colours and the codes as they
    /// were.
    SetValues {
        column: ColumnId,
        values: ColumnValues,
    },
}

/// The value of one cell of a column of numbers or text, of the column's
/// storage type, `None` for a missing value.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CellValue {
    /// A whole number.
    Integer(Option<i64>),
    /// A decimal number, finite.
    Float(Option<f64>),
    /// A text, never empty.
    Text(Option<String>),
}
