//! The commands that change the session, and the request that carries
//! one to the dispatcher.

use crate::filter::Filter;
use crate::ids::{ColumnId, LevelCode, Revision, RowIndex, SentAt};
use crate::row_set::RowSet;
use crate::session::{EditMode, Selected};
use crate::table::{Colour, Role, Table};

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
    /// Sets the selection. While + or − is pressed, the rows that enter
    /// it are assigned or unassigned in the same command, which is one undo.
    SetSelection {
        /// The rows selected.
        rows: RowSet,
    },
    /// Sets the filter of the find bar, which changes the rows the table
    /// shows. It is not undone.
    SetFilter {
        /// The filter.
        filter: Filter,
        /// The decimal mark the window writes decimal numbers with, its
        /// system's region's, so that a number matches by the text shown:
        /// one to three characters.
        decimal_mark: String,
    },
    /// Sets the individual under the pointer. It takes no revision.
    SetHover {
        /// The row, or `None` when the pointer is over no individual.
        row: Option<RowIndex>,
    },
    /// Sets the active classification, which clears the selected
    /// population.
    SetActiveClassification {
        /// A category, of countries or not, or `None` for none.
        column: Option<ColumnId>,
    },
    /// Selects a population of the active classification, or its
    /// unassigned individuals, for editing, or nothing.
    SelectPopulation {
        /// The active classification.
        column: ColumnId,
        /// What to select, or `None`.
        selected: Option<Selected>,
    },
    /// Presses the button + or − on what is selected for editing, or
    /// releases the one pressed. Pressing one gives the rows selected now
    /// what it gives every row that enters the selection after, in the same
    /// command (`docs/design.md`, section 2.1).
    SetEditMode {
        /// The active classification.
        column: ColumnId,
        /// What is selected.
        target: Selected,
        /// The button pressed, or `None` to release it.
        mode: Option<EditMode>,
    },
    /// Assigns the rows to what is selected: a lasso in add mode, which
    /// with the unassigned individuals selected leaves the rows unassigned.
    AssignRows {
        /// The active classification.
        column: ColumnId,
        /// What is selected.
        target: Selected,
        /// The rows inside the lasso.
        rows: RowSet,
    },
    /// Adds a population with no individuals to the active classification,
    /// last, with the first colour of [`crate::PALETTE`] that none of its
    /// populations has, and selects it for editing. `name` is read as a
    /// value of the column's storage type, a decimal number with
    /// `decimal_mark` and a country by any of its ISO names or codes;
    /// spaces around it are ignored.
    AddPopulation {
        /// The active classification.
        column: ColumnId,
        /// The name typed.
        name: String,
        /// The decimal mark the window writes decimal numbers with, its
        /// system's region's: one to three characters.
        decimal_mark: String,
    },
    /// Deletes a population of the active classification: its individuals
    /// become unassigned, and each population after it takes the code
    /// before its own. Undo gives it back, in its place, with its
    /// individuals (`docs/design.md`, section 2.1).
    DeletePopulation {
        /// The active classification.
        column: ColumnId,
        /// The population.
        population: LevelCode,
    },
    /// Gives a population of the active classification another name, or
    /// another colour of [`crate::PALETTE`], or both; its code and its
    /// individuals stay. `name` is read as for [`Command::AddPopulation`].
    EditPopulation {
        /// The active classification.
        column: ColumnId,
        /// The population.
        population: LevelCode,
        /// The name typed, which may be the one it has.
        name: String,
        /// Its colour, one of [`crate::PALETTE`].
        colour: Colour,
        /// The decimal mark the window writes decimal numbers with, its
        /// system's region's: one to three characters.
        decimal_mark: String,
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
    /// Sets the role of a column other than the first. The active
    /// classification made a number or text stops being active.
    SetRole {
        /// The column.
        column: ColumnId,
        /// Its new role.
        role: Role,
    },
    /// Sets the cells of `rows` in `column` to the value `text` gives, read
    /// by the column's storage type with `decimal_mark`: a number, a text,
    /// a value of a category, or a name of the first column; an empty text
    /// is a missing value, which the first column never has. Every row
    /// changes or none, and one undo reverts them all.
    SetCells {
        /// The column, the first included.
        column: ColumnId,
        /// The rows whose cells are set: one, or the selection's; one only
        /// in the first column.
        rows: RowSet,
        /// The text typed.
        text: String,
        /// The decimal mark the window writes decimal numbers with, its
        /// system's region's, by which a decimal number typed is read: one
        /// to three characters.
        decimal_mark: String,
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
