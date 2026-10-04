//! The core of Vavilov Explorer: the table of individuals, the session
//! that every window shares, and the commands that change it, with their
//! undo and the binary messages that carry each change to the windows.
//!
//! The core has no Tauri, so that its tests cover the backend's logic
//! without a window and the test program of the e2e harness runs the same
//! dispatcher as the app. Its design is in `docs/core.md`.

#![forbid(unsafe_code)]

mod cells;
mod command;
mod convert;
mod countries;
mod description;
mod dispatch;
mod edit;
mod error;
mod export;
mod files;
mod filter;
#[cfg(test)]
mod fixtures;
mod formats;
mod ids;
mod import;
mod message;
mod numbers;
mod row_set;
mod rows;
mod session;
mod table;
mod text;

pub use command::{Command, Request};
pub use countries::{Country, country_code, country_of};
pub use description::{
    ColumnDescription, CountryDescription, LevelDescription, LevelValue, NamesDescription,
    TableDescription,
};
pub use dispatch::{Changed, Dropped, Outcome};
pub use error::{CellRefusal, CommandError, ExportRefusal, GroupRefusal, ImportRefusal, IoFailure};
pub use export::export_table;
pub use files::{file_name, read_for_import, write_export};
pub use filter::{Comparison, Condition, Filter, MAX_FILTER_TEXT, Showing};
pub use formats::{
    CsvChoices, CsvEncoding, DecimalMark, ExportFormat, FileFormat, MissingText, Separator,
};
pub use ids::{
    ColumnId, HoverSeq, LevelCode, MAX_EXACT_IN_JAVASCRIPT, Position, Revision, RowIndex, SentAt,
    WindowLabel,
};
pub use import::{Imported, MAX_GUESSED_LEVELS, MAX_IMPORT_BYTES, MAX_IMPORT_CELLS, import_table};
pub use row_set::RowSet;
pub use rows::RowsRequest;
pub use session::{
    Active, Delivery, EditMode, Selected, SelectedGroups, SendFailed, Session, Subscriber, UndoRedo,
};
pub use table::{
    Categorical, Colour, Column, ColumnValues, INDIVIDUAL_ID, LevelValues, MAX_COLUMNS,
    MAX_GROUP_NAME, MAX_LEVELS, MAX_ROWS, NameColumn, NewColumn, Numbers, PALETTE, Role,
    StorageType, Stored, Table, is_individual_id, palette,
};
