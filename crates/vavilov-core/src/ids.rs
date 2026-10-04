//! The small values that name things: columns, rows, positions among the
//! rows shown, levels, revisions, hovers and windows. Each is a type of its own, so that a row cannot be
//! passed where a column is meant.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::CommandError;

/// The largest integer a JavaScript number holds exactly, 2^53 − 1. The
/// windows read revisions and hover sequence numbers as numbers, so
/// neither may pass it (`docs/core.md`, section 4).
pub const MAX_EXACT_IN_JAVASCRIPT: u64 = 9_007_199_254_740_991;

/// The id of a column, given when the column is created and never
/// changed or given again within a table. `u32::MAX` is never an id: the
/// messages use it for "no column".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ColumnId(u32);

impl ColumnId {
    /// The column with this id, which may not be in the table: a window's
    /// id is checked when a command uses it.
    #[must_use]
    pub const fn new(id: u32) -> Self {
        Self(id)
    }

    /// The id as a number.
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

impl fmt::Display for ColumnId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// A row of the table, from 0, one row per individual.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct RowIndex(u32);

impl RowIndex {
    /// The row with this index, which may be beyond the table: a window's
    /// row is checked when a command uses it.
    #[must_use]
    pub const fn new(row: u32) -> Self {
        Self(row)
    }

    /// The index as a number.
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

impl fmt::Display for RowIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// The place of a row among the rows the filter shows, from 0, as the
/// table's pages count them. With no filter it equals the row.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Position(u32);

impl Position {
    /// The position with this number, which may be past the rows shown: a
    /// window's position is checked when a page is made.
    #[must_use]
    pub const fn new(position: u32) -> Self {
        Self(position)
    }

    /// The position as a number.
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

impl fmt::Display for Position {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// The code of a level of a categorical column: its place in the
/// column's ordered list of levels, from 0. In a classification, a level
/// is a group.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LevelCode(u16);

impl LevelCode {
    /// The level with this code, which may not be in the column: a
    /// window's code is checked when a command uses it.
    #[must_use]
    pub const fn new(code: u16) -> Self {
        Self(code)
    }

    /// The code as a number.
    #[must_use]
    pub const fn get(self) -> u16 {
        self.0
    }
}

impl fmt::Display for LevelCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// The revision of the session: it starts at 0, grows by one with every
/// command that changes the document or the interaction, and never goes
/// back, not even on undo or when another project is opened.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Revision(u64);

impl Revision {
    /// The revision of a session no command has changed.
    pub const ZERO: Self = Self(0);

    /// The revision with this number, as a window gives it with a
    /// command.
    #[must_use]
    pub const fn new(revision: u64) -> Self {
        Self(revision)
    }

    /// The revision as a number.
    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }

    /// The revision after this one.
    pub(crate) fn next(self) -> Result<Self, CommandError> {
        next_exact(self.0, "the revision").map(Self)
    }
}

impl fmt::Display for Revision {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// The sequence number of a hover, which grows by one with every hover.
/// The hover takes no revision, so that hovers can be dropped without
/// leaving a gap in the revisions; a window keeps the hover with the
/// highest sequence number it has seen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct HoverSeq(u64);

impl HoverSeq {
    /// The sequence number of a session that has had no hover.
    pub const ZERO: Self = Self(0);

    /// The sequence number with this number.
    #[must_use]
    pub const fn new(seq: u64) -> Self {
        Self(seq)
    }

    /// The sequence number as a number.
    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }

    /// The sequence number after this one.
    pub(crate) fn next(self) -> Result<Self, CommandError> {
        next_exact(self.0, "the hover's sequence number").map(Self)
    }
}

/// The number after `value`, refused as a defect beyond what a window can
/// read exactly.
fn next_exact(value: u64, what: &str) -> Result<u64, CommandError> {
    value
        .checked_add(1)
        .filter(|next| *next <= MAX_EXACT_IN_JAVASCRIPT)
        .ok_or_else(|| CommandError::Defect {
            what: format!("{what} would pass {MAX_EXACT_IN_JAVASCRIPT}"),
        })
}

/// The name of a subscriber, which the core does not read: the label of the
/// window it is, fixed when the window is created by the app layer, `main`
/// or such as `plots-2` (`docs/core.md`, section 7). It never holds a
/// user's text.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct WindowLabel(String);

impl WindowLabel {
    /// The label of the main window.
    pub const MAIN: &str = "main";

    /// The window with this label, as Tauri gives it.
    #[must_use]
    pub fn new(label: impl Into<String>) -> Self {
        Self(label.into())
    }

    /// The label of the main window.
    #[must_use]
    pub fn main() -> Self {
        Self::new(Self::MAIN)
    }

    /// The label as text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for WindowLabel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// The time a window gave with a command, in milliseconds since the
/// epoch by the window's clock. The core copies it into the message of
/// the change and never reads a clock itself; it is how the latency
/// between windows is measured.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SentAt(f64);

impl SentAt {
    /// The time a window gave.
    ///
    /// # Errors
    ///
    /// A `Defect` when the time is not finite, which no clock gives.
    pub fn new(milliseconds: f64) -> Result<Self, CommandError> {
        if milliseconds.is_finite() {
            Ok(Self(milliseconds))
        } else {
            Err(CommandError::Defect {
                what: format!("a window gave the time {milliseconds}"),
            })
        }
    }

    /// The time in milliseconds.
    #[must_use]
    pub const fn get(self) -> f64 {
        self.0
    }
}

#[cfg(test)]
mod tests;
