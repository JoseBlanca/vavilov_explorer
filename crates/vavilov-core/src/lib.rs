//! The core of Vavilov Explorer: the table of individuals, the session
//! that every window shares, and the commands that change it, with their
//! undo and the binary messages that carry each change to the windows.
//!
//! The core has no Tauri, so that its tests cover the backend's logic
//! without a window and the test program of the e2e harness runs the same
//! dispatcher as the app. Its design is in `docs/core.md`.

#![forbid(unsafe_code)]

mod command;
mod convert;
mod description;
mod dispatch;
mod edit;
mod error;
#[cfg(test)]
mod fixtures;
mod ids;
mod message;
mod row_set;
mod rows;
mod session;
mod table;

pub use command::{Command, Request};
pub use description::{
    ColumnDescription, LevelDescription, LevelValue, NamesDescription, RoleDescription,
    TableDescription,
};
pub use dispatch::{Changed, Dropped, Outcome};
pub use error::CommandError;
pub use ids::{
    ColumnId, HoverSeq, LevelCode, MAX_EXACT_IN_JAVASCRIPT, Revision, RowIndex, SentAt, WindowLabel,
};
pub use row_set::RowSet;
pub use rows::RowsRequest;
pub use session::{Active, Selected, SendFailed, Session, Subscriber, UndoRedo};
pub use table::{
    Categorical, Colour, Column, ColumnValues, LevelValues, MAX_COLUMNS, MAX_LEVELS, MAX_ROWS,
    NameColumn, NewColumn, Numbers, PALETTE, Role, StorageType, Stored, Table, palette,
};
