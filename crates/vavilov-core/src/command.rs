//! The commands that change the session, and the request that carries
//! one to the dispatcher.

use crate::ids::{ColumnId, LevelCode, Revision, RowIndex, SentAt};
use crate::row_set::RowSet;
use crate::table::Table;

/// A change to the document or the interaction. Each names what it acts
/// on, rather than leaning on the session's current value, so that a
/// command made from a window's stale copy is refused instead of applied
/// to something else (`docs/core.md`, section 4).
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    /// Opens a table as the project, replacing the one open, with its
    /// history and interaction. Not undone.
    LoadTable {
        /// The table.
        table: Table,
        /// The active classification to start with.
        active_classification: Option<ColumnId>,
    },
    /// Sets the selection.
    SetSelection {
        /// The rows selected.
        rows: RowSet,
    },
    /// Sets the individual under the pointer. It takes no revision.
    SetHover {
        /// The row, or `None` when the pointer is over no individual.
        row: Option<RowIndex>,
    },
    /// Sets the active classification, which clears the selected
    /// population.
    SetActiveClassification {
        /// A categorical column, or `None` for no classification.
        column: Option<ColumnId>,
    },
    /// Selects a population of the active classification for editing, or
    /// none.
    SelectPopulation {
        /// The active classification.
        column: ColumnId,
        /// The population, or `None`.
        population: Option<LevelCode>,
    },
    /// Assigns the rows to the selected population: a lasso in add mode.
    AssignRows {
        /// The active classification.
        column: ColumnId,
        /// The selected population.
        population: LevelCode,
        /// The rows inside the lasso.
        rows: RowSet,
    },
    /// Leaves unassigned the rows of the selected population that are in
    /// `rows`, and leaves the others as they are: a lasso in remove mode.
    UnassignRows {
        /// The active classification.
        column: ColumnId,
        /// The selected population.
        population: LevelCode,
        /// The rows inside the lasso.
        rows: RowSet,
    },
    /// Undoes the last edit of the document.
    Undo,
    /// Redoes the last edit undone.
    Redo,
}

/// A command, with what the window knew when it made it.
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    /// The command.
    pub command: Command,
    /// The revision of the window's copy when it made the command; the
    /// current revision for a command of the backend itself, such as the
    /// menu's Undo.
    pub based_on: Revision,
    /// The time the window gave, copied into the message of the change.
    pub sent_at: Option<SentAt>,
}
