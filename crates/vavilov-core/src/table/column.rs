//! A column of the table other than the first, and its values.

use crate::error::CommandError;
use crate::ids::{ColumnId, LevelCode, Revision};
use crate::table::level::Level;

/// The values of a column, one per row, `None` for a missing value. A
/// numeric value is always finite.
#[derive(Clone, Debug, PartialEq)]
pub enum ColumnValues {
    /// Numbers, 64-bit floats.
    Numeric(Vec<Option<f64>>),
    /// Whole numbers, 64 bits.
    Integer(Vec<Option<i64>>),
    /// Texts, as written.
    Text(Vec<Option<String>>),
    /// True or false.
    Boolean(Vec<Option<bool>>),
    /// For each row a code into an ordered list of levels.
    Categorical(Categorical),
}

impl ColumnValues {
    /// The number of values, one per row.
    #[must_use]
    pub fn len(&self) -> usize {
        match self {
            Self::Numeric(values) => values.len(),
            Self::Integer(values) => values.len(),
            Self::Text(values) => values.len(),
            Self::Boolean(values) => values.len(),
            Self::Categorical(categorical) => categorical.codes.len(),
        }
    }

    /// Whether the column has no value, as in a table of no row.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// The values of a categorical column: its ordered levels, and for each
/// row the code of its level or `None`, which in a classification is an
/// unassigned individual. A level no row uses is allowed: it is how a
/// new, empty population exists.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Categorical {
    pub(crate) levels: Vec<Level>,
    pub(crate) codes: Vec<Option<LevelCode>>,
}

impl Categorical {
    /// The levels and the codes, checked when the table is built.
    #[must_use]
    pub const fn new(levels: Vec<Level>, codes: Vec<Option<LevelCode>>) -> Self {
        Self { levels, codes }
    }

    /// The levels, in their order.
    #[must_use]
    pub fn levels(&self) -> &[Level] {
        &self.levels
    }

    /// The code of each row, `None` for a missing value.
    #[must_use]
    pub fn codes(&self) -> &[Option<LevelCode>] {
        &self.codes
    }

    /// The number of levels, at most [`crate::MAX_LEVELS`] in a table.
    pub(crate) fn num_levels(&self) -> Result<u32, CommandError> {
        u32::try_from(self.levels.len()).map_err(|_| CommandError::Defect {
            what: format!("a column of {} levels", self.levels.len()),
        })
    }
}

/// A column of the table other than the first.
#[derive(Clone, Debug, PartialEq)]
pub struct Column {
    pub(crate) id: ColumnId,
    pub(crate) name: String,
    pub(crate) revision: Revision,
    pub(crate) values: ColumnValues,
}

impl Column {
    /// The id, which never changes.
    #[must_use]
    pub const fn id(&self) -> ColumnId {
        self.id
    }

    /// The name, unique within the table.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The revision of the session at which the column last changed.
    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    /// The values.
    #[must_use]
    pub const fn values(&self) -> &ColumnValues {
        &self.values
    }

    /// The values when the column is categorical.
    #[must_use]
    pub const fn categorical(&self) -> Option<&Categorical> {
        match &self.values {
            ColumnValues::Categorical(categorical) => Some(categorical),
            ColumnValues::Numeric(_)
            | ColumnValues::Integer(_)
            | ColumnValues::Text(_)
            | ColumnValues::Boolean(_) => None,
        }
    }
}
