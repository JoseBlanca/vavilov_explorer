//! The one error enum of the core, which is also what a window receives
//! when a command is refused (`docs/core.md`, section 6).

mod cell;
mod file;
mod group;

pub use cell::CellRefusal;
pub use file::{ExportRefusal, ImportRefusal, IoFailure};
pub use group::GroupRefusal;

use serde::Serialize;

use crate::ids::{ColumnId, LevelCode, Position, Revision, RowIndex, WindowLabel};
use crate::table::{Role, StorageType};

/// Why a command was refused, or a table could not be built.
///
/// It crosses to a window as an object with a `kind`, the name of the
/// case in camelCase, and the case's fields, in camelCase too:
/// `{"kind":"unknownLevel","column":3,"code":7,"numLevels":2}`. The window
/// writes the words the user reads from the kind and the data; the text of
/// each case here is for logs and for the technical details of a report.
/// A refused command has changed nothing.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CommandError {
    /// The command needs a table and no project is open.
    #[error("no project is open")]
    NoProject,

    /// The command was made by a window before the current table was
    /// loaded, so its rows and columns may be those of the old table.
    #[error("the command was made at revision {based_on}, before the table loaded at {loaded_at}")]
    MadeBeforeLoad {
        /// The revision of the window's copy when it made the command.
        based_on: Revision,
        /// The revision at which the current table was loaded.
        loaded_at: Revision,
    },

    /// The command names a group of a column whose groups
    /// changed after the window made it, other than by one added last: a
    /// group removed, or the column's role changed. Its code may now
    /// mean another group.
    #[error(
        "the command was made at revision {based_on}, before the levels of column {column} changed at {levels_at}"
    )]
    LevelsChanged {
        /// The column the command gave.
        column: ColumnId,
        /// The revision of the window's copy when it made the command.
        based_on: Revision,
        /// The revision at which the column's levels last changed.
        levels_at: Revision,
    },

    /// A window subscribed with a label that is neither the main window
    /// nor an open widget.
    #[error("no window {label} is open")]
    UnknownWindow {
        /// The label the window gave.
        label: WindowLabel,
    },

    /// No column of the table has this id.
    #[error("column {column} is not in the table")]
    UnknownColumn {
        /// The id the command gave.
        column: ColumnId,
    },

    /// The command needs a category, which the active classification is.
    #[error("column {column} is not a category")]
    NotCategory {
        /// The column the command gave.
        column: ColumnId,
    },

    /// The command needs a number, of its sub-roles or not, such as an axis
    /// of a 3D scatter, and the column is a category or text.
    #[error("column {column} is not a number")]
    NotNumber {
        /// The column the command gave.
        column: ColumnId,
    },

    /// The command needs a column of one role, such as the latitude of a
    /// map or the countries of a map of countries, and the column has
    /// another.
    #[error("column {column} is not of the role {role:?}")]
    NotRole {
        /// The column the command gave.
        column: ColumnId,
        /// The role the command needs.
        role: Role,
    },

    /// A window could not be opened or closed by the system.
    #[error("window {label} could not be opened or closed: {message}")]
    WindowFailed {
        /// The window's label.
        label: WindowLabel,
        /// The system's message, for the technical details.
        message: String,
    },

    /// The column's storage type cannot take the role asked for: a number
    /// needs numbers, and text needs text (`docs/design.md`, section 6).
    #[error("column {column}, of {storage:?}, cannot be a {role:?}")]
    RoleNotPossible {
        /// The column the command gave.
        column: ColumnId,
        /// Its storage type.
        storage: StorageType,
        /// The role asked for.
        role: Role,
    },

    /// The command acts on the active classification, and this column is
    /// not it, or there is none.
    #[error("column {column} is not the active classification")]
    NotActiveClassification {
        /// The column the command gave.
        column: ColumnId,
    },

    /// The column has no level with this code.
    #[error("column {column} has {num_levels} levels and no level {code}")]
    UnknownLevel {
        /// The column the command gave.
        column: ColumnId,
        /// The code the command gave.
        code: LevelCode,
        /// How many levels the column has.
        num_levels: u32,
    },

    /// The command acts on the selected group and none is selected.
    #[error("no group is selected")]
    NoGroupSelected,

    /// The command names a selection of groups that is not the one
    /// selected: it was made before something else was selected.
    #[error("the command names another selection than the one selected")]
    NotSelected,

    /// A set of rows has as many bytes as a table of another number of
    /// rows would.
    #[error("a set of rows of {num_bytes} bytes for a table of {num_rows} rows")]
    RowSetLength {
        /// The rows of the table.
        num_rows: u32,
        /// The bytes the set has.
        num_bytes: u64,
    },

    /// A set of rows has a bit set beyond the last row.
    #[error("a set of rows for a table of {num_rows} rows has a bit set beyond the last row")]
    RowSetUnusedBits {
        /// The rows of the table.
        num_rows: u32,
    },

    /// A row beyond the last row of the table.
    #[error("row {row} is beyond the {num_rows} rows of the table")]
    RowOutOfRange {
        /// The row the command gave.
        row: RowIndex,
        /// The rows of the table.
        num_rows: u32,
    },

    /// A page of rows that goes past the last of the rows the filter
    /// shows, all of the table's when there is no filter.
    #[error("{count} rows from position {first} go past the {num_shown} rows shown")]
    RowsOutOfRange {
        /// The position among the rows shown of the first row the window
        /// asked for.
        first: Position,
        /// The number of rows it asked for.
        count: u32,
        /// The number of rows shown.
        num_shown: u32,
    },

    /// Undo with nothing to undo.
    #[error("there is nothing to undo")]
    NothingToUndo,

    /// Redo with nothing to redo.
    #[error("there is nothing to redo")]
    NothingToRedo,

    /// A table of more rows than [`crate::MAX_ROWS`].
    #[error("a table of {num_rows} rows, more than the {max_rows} the app takes")]
    TooManyRows {
        /// The rows of the table.
        num_rows: u64,
        /// [`crate::MAX_ROWS`].
        max_rows: u32,
    },

    /// A table of more columns than [`crate::MAX_COLUMNS`], the first
    /// column included.
    #[error("a table of {num_columns} columns, more than the {max_columns} the app takes")]
    TooManyColumns {
        /// The columns of the table, the first included.
        num_columns: u64,
        /// [`crate::MAX_COLUMNS`].
        max_columns: u32,
    },

    /// The first column's header is not `IndividualID`, as
    /// [`crate::is_individual_id`] compares them.
    #[error("the first column is named {header:?}, not IndividualID")]
    NotIndividualId {
        /// The header the table gave.
        header: String,
    },

    /// A row of the first column, the names of the individuals, is empty.
    #[error("row {row} has no name")]
    EmptyIndividual {
        /// The row, from 0.
        row: RowIndex,
    },

    /// Two rows of the first column have the same name.
    #[error("the name {name:?} is in rows {first_row} and {second_row}")]
    DuplicateIndividual {
        /// The name.
        name: String,
        /// The first row with it, from 0.
        first_row: RowIndex,
        /// The second.
        second_row: RowIndex,
    },

    /// A column other than the first has an empty name.
    #[error("column {position} has no name")]
    EmptyColumnName {
        /// Its place in the table, the first column being 0.
        position: u32,
    },

    /// Two columns have the same name.
    #[error("two columns are named {name:?}")]
    DuplicateColumnName {
        /// The name.
        name: String,
    },

    /// A column has another number of values than the table has rows.
    #[error("column {column_name:?} has {num_values} values for {num_rows} rows")]
    ColumnLength {
        /// The name of the column.
        column_name: String,
        /// The values it has.
        num_values: u64,
        /// The rows of the table.
        num_rows: u32,
    },

    /// A numeric column holds a value that is not finite.
    #[error("column {column_name:?} holds a value that is not a finite number in row {row}")]
    NonFiniteNumber {
        /// The name of the column.
        column_name: String,
        /// The row, from 0.
        row: RowIndex,
    },

    /// A column of text holds an empty text, which a table holds as a
    /// missing value instead (`docs/design.md`, section 7: an empty cell
    /// is missing).
    #[error("column {column_name:?} holds an empty text in row {row}")]
    EmptyText {
        /// The name of the column.
        column_name: String,
        /// The row, from 0.
        row: RowIndex,
    },

    /// A category of more levels than [`crate::MAX_LEVELS`].
    #[error(
        "column {column_name:?} has {num_levels} levels, more than the {max_levels} the app takes"
    )]
    TooManyLevels {
        /// The name of the column.
        column_name: String,
        /// The levels it has.
        num_levels: u64,
        /// [`crate::MAX_LEVELS`].
        max_levels: u32,
    },

    /// A value of the column that the sub-role asked for does not take: a
    /// latitude or a longitude out of its range, or a text that names no
    /// country.
    #[error("row {row} of column {column} cannot be a {role:?}")]
    ValueNotFor {
        /// The column the command gave.
        column: ColumnId,
        /// The sub-role asked for.
        role: Role,
        /// The first row whose value it does not take.
        row: RowIndex,
    },

    /// A level of a country category that is not the
    /// code a country is shown by.
    #[error("level {level:?} of column {column_name:?} is no country's code")]
    NotACountry {
        /// The name of the column.
        column_name: String,
        /// The level.
        level: String,
    },

    /// A category has another number of colours than
    /// levels.
    #[error("column {column_name:?} has {num_levels} levels and {num_colours} colours")]
    LevelColours {
        /// The name of the column.
        column_name: String,
        /// The levels it has.
        num_levels: u64,
        /// The colours it has.
        num_colours: u64,
    },

    /// A level of decimal numbers that is not finite.
    #[error("level {code} of column {column_name:?} is not a finite number")]
    NonFiniteLevel {
        /// The name of the column.
        column_name: String,
        /// The code of the level.
        code: LevelCode,
    },

    /// A level of text of a category is empty.
    #[error("level {code} of column {column_name:?} has no name")]
    EmptyLevelName {
        /// The name of the column.
        column_name: String,
        /// The code of the level.
        code: LevelCode,
    },

    /// Two levels of a category are the same.
    #[error("two levels of column {column_name:?} are named {level:?}")]
    DuplicateLevel {
        /// The name of the column.
        column_name: String,
        /// The name of the level.
        level: String,
    },

    /// A row of a category holds a code with no level.
    #[error(
        "row {row} of column {column_name:?} holds code {code}, and the column has {num_levels} levels"
    )]
    CodeWithoutLevel {
        /// The name of the column.
        column_name: String,
        /// The row, from 0.
        row: RowIndex,
        /// The code it holds.
        code: LevelCode,
        /// The levels of the column.
        num_levels: u32,
    },

    /// A file the user chose to import was refused, and nothing loaded.
    #[error("{file_name:?} was not imported: {refusal:?}")]
    ImportRefused {
        /// The name of the file, without its folder.
        file_name: String,
        /// Why.
        refusal: ImportRefusal,
    },

    /// A file the user chose to import could not be read as what its first
    /// bytes say it is, a damaged xlsx.
    #[error("{file_name:?} could not be read: {message}")]
    ImportUnreadable {
        /// The name of the file, without its folder.
        file_name: String,
        /// The reader's message, for the technical details.
        message: String,
    },

    /// A file the user chose could not be read from the disk.
    #[error("{file_name:?} could not be read from the disk: {message}")]
    FileNotRead {
        /// The name of the file, without its folder.
        file_name: String,
        /// What the system refused.
        io: IoFailure,
        /// The system's message, for the technical details.
        message: String,
    },

    /// The table was not exported, and no file was written.
    #[error("the table was not exported: {refusal:?}")]
    ExportRefused {
        /// Why.
        refusal: ExportRefusal,
    },

    /// The file the user chose could not be written to the disk; a file
    /// that was there is left as it was.
    #[error("{file_name:?} could not be written: {message}")]
    FileNotWritten {
        /// The name of the file, without its folder.
        file_name: String,
        /// What the system refused.
        io: IoFailure,
        /// The system's message, for the technical details.
        message: String,
    },

    /// A value typed in the cells of a column does not fit it, and every
    /// cell keeps its value.
    #[error("{text:?} does not fit column {column_name:?}: {refusal:?}")]
    CellRefused {
        /// The name of the column, `IndividualID` for the first.
        column_name: String,
        /// The text typed.
        text: String,
        /// Why.
        refusal: CellRefusal,
    },

    /// The name typed for a new group of the active classification
    /// does not fit it, and nothing was added.
    #[error("{text:?} was not added to column {column_name:?}: {refusal:?}")]
    GroupRefused {
        /// The name of the column.
        column_name: String,
        /// The name typed.
        text: String,
        /// Why.
        refusal: GroupRefusal,
    },

    /// A defect of the app: a state the code is meant to make impossible.
    /// The window shows it as a defect, and the user's data has not been
    /// changed.
    #[error("defect: {what}")]
    Defect {
        /// What was found, for the report.
        what: String,
    },
}

#[cfg(test)]
mod tests;
