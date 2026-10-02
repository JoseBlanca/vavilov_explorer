//! A column of the table other than the first: its values, held in the
//! shape its role gives them, and the storage type they keep
//! (`docs/design.md`, section 6).

use serde::{Deserialize, Serialize};

use crate::error::CommandError;
use crate::ids::{ColumnId, LevelCode, Revision};
use crate::table::colour::{Colour, palette};

/// What the values of a column are, as the import read them. It never
/// changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageType {
    /// Whole numbers, 64 bits.
    Integer,
    /// Decimal numbers, 64-bit floats.
    Float,
    /// Yes or no.
    Boolean,
    /// Text, as written.
    Text,
}

/// What a column is for, which the user chooses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    /// Drawn on an axis, in a histogram or as coordinates.
    Number,
    /// A trait, drawn in a bar plot and never edited.
    Category,
    /// Populations, which a lasso edits.
    Classification,
    /// Notes and identifiers, shown in the table alone.
    Text,
}

/// The values of a column as stored, one per row, `None` for a missing
/// value: what the import reads, and what a change of role starts from.
#[derive(Clone, Debug, PartialEq)]
pub enum Stored {
    /// Whole numbers.
    Integer(Vec<Option<i64>>),
    /// Decimal numbers, each finite.
    Float(Vec<Option<f64>>),
    /// Yes or no.
    Boolean(Vec<Option<bool>>),
    /// Text.
    Text(Vec<Option<String>>),
}

impl Stored {
    /// The storage type of the values.
    #[must_use]
    pub const fn storage_type(&self) -> StorageType {
        match self {
            Self::Integer(_) => StorageType::Integer,
            Self::Float(_) => StorageType::Float,
            Self::Boolean(_) => StorageType::Boolean,
            Self::Text(_) => StorageType::Text,
        }
    }
}

/// The values of a column whose role is a number.
#[derive(Clone, Debug, PartialEq)]
pub enum Numbers {
    /// Whole numbers.
    Integer(Vec<Option<i64>>),
    /// Decimal numbers, each finite.
    Float(Vec<Option<f64>>),
}

/// The values of the levels of a category or a classification, in the
/// order of their codes, each of the column's storage type and none twice.
#[derive(Clone, Debug, PartialEq)]
pub enum LevelValues {
    /// Whole numbers.
    Integer(Vec<i64>),
    /// Decimal numbers, each finite.
    Float(Vec<f64>),
    /// Yes or no.
    Boolean(Vec<bool>),
    /// Texts, none empty.
    Text(Vec<String>),
}

impl LevelValues {
    /// The number of levels.
    #[must_use]
    pub fn len(&self) -> usize {
        match self {
            Self::Integer(values) => values.len(),
            Self::Float(values) => values.len(),
            Self::Boolean(values) => values.len(),
            Self::Text(values) => values.len(),
        }
    }

    /// Whether there is no level.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The level of `code` as text, for the messages of errors.
    pub(crate) fn text_of(&self, index: usize) -> Option<String> {
        match self {
            Self::Integer(values) => values.get(index).map(ToString::to_string),
            Self::Float(values) => values.get(index).map(ToString::to_string),
            Self::Boolean(values) => values.get(index).map(ToString::to_string),
            Self::Text(values) => values.get(index).cloned(),
        }
    }
}

/// The values of a category or a classification: its ordered levels,
/// each with a colour, and for each row the code of its level or `None`,
/// which in a classification is an unassigned individual. A level no row
/// uses is allowed: it is how a new, empty population exists.
#[derive(Clone, Debug, PartialEq)]
pub struct Categorical {
    pub(crate) levels: LevelValues,
    pub(crate) colours: Vec<Colour>,
    pub(crate) codes: Vec<Option<LevelCode>>,
}

impl Categorical {
    /// The levels, their colours and the codes, checked when the table is
    /// built.
    #[must_use]
    pub const fn new(
        levels: LevelValues,
        colours: Vec<Colour>,
        codes: Vec<Option<LevelCode>>,
    ) -> Self {
        Self {
            levels,
            colours,
            codes,
        }
    }

    /// The values of each row as levels: one level per distinct value, in
    /// the order of `docs/design.md`, section 5, each with the colour of
    /// its place in the list of colours.
    ///
    /// # Errors
    ///
    /// `TooManyLevels` for more distinct values than [`crate::MAX_LEVELS`],
    /// named after `column_name`.
    pub fn from_stored(stored: &Stored, column_name: &str) -> Result<Self, CommandError> {
        match stored {
            Stored::Integer(values) => {
                let (levels, codes) = levels_of(values, i64::cmp, column_name)?;
                Ok(Self::with_palette(LevelValues::Integer(levels), codes))
            }
            Stored::Float(values) => {
                let (levels, codes) = levels_of(values, float_order, column_name)?;
                Ok(Self::with_palette(LevelValues::Float(levels), codes))
            }
            Stored::Boolean(values) => {
                let (levels, codes) = levels_of(values, bool::cmp, column_name)?;
                Ok(Self::with_palette(LevelValues::Boolean(levels), codes))
            }
            Stored::Text(values) => {
                let (levels, codes) = levels_of(values, text_order, column_name)?;
                Ok(Self::with_palette(LevelValues::Text(levels), codes))
            }
        }
    }

    fn with_palette(levels: LevelValues, codes: Vec<Option<LevelCode>>) -> Self {
        let colours = palette(levels.len());
        Self {
            levels,
            colours,
            codes,
        }
    }

    /// The levels, in the order of their codes.
    #[must_use]
    pub const fn levels(&self) -> &LevelValues {
        &self.levels
    }

    /// The colour of each level, in the order of their codes.
    #[must_use]
    pub fn colours(&self) -> &[Colour] {
        &self.colours
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

    /// The values of each row, as stored.
    ///
    /// # Errors
    ///
    /// A `Defect` for a code with no level, which the table makes
    /// impossible.
    pub fn to_stored(&self) -> Result<Stored, CommandError> {
        Ok(match &self.levels {
            LevelValues::Integer(levels) => Stored::Integer(self.values_of(levels)?),
            LevelValues::Float(levels) => Stored::Float(self.values_of(levels)?),
            LevelValues::Boolean(levels) => Stored::Boolean(self.values_of(levels)?),
            LevelValues::Text(levels) => Stored::Text(self.values_of(levels)?),
        })
    }

    fn values_of<T: Clone>(&self, levels: &[T]) -> Result<Vec<Option<T>>, CommandError> {
        self.codes
            .iter()
            .map(|code| {
                code.map(|code| {
                    levels.get(usize::from(code.get())).cloned().ok_or_else(|| {
                        CommandError::Defect {
                            what: format!("a code {code} of {} levels", levels.len()),
                        }
                    })
                })
                .transpose()
            })
            .collect()
    }
}

/// The order of the levels of text: case ignored, ties by the exact text
/// (`docs/design.md`, section 5).
fn text_order(first: &String, second: &String) -> std::cmp::Ordering {
    first
        .to_lowercase()
        .cmp(&second.to_lowercase())
        .then_with(|| first.cmp(second))
}

/// The order of the levels of decimal numbers: as numbers, so that −0
/// and 0 are one level. The values are finite, so no two are unordered.
fn float_order(first: &f64, second: &f64) -> std::cmp::Ordering {
    first
        .partial_cmp(second)
        .unwrap_or_else(|| first.total_cmp(second))
}

/// The distinct values of `values`, in the order of `order`, and the code
/// of each row into them.
fn levels_of<T: Clone>(
    values: &[Option<T>],
    order: impl Fn(&T, &T) -> std::cmp::Ordering,
    column_name: &str,
) -> Result<(Vec<T>, Vec<Option<LevelCode>>), CommandError> {
    let mut levels: Vec<T> = values.iter().flatten().cloned().collect();
    levels.sort_by(&order);
    levels.dedup_by(|second, first| order(first, second).is_eq());
    let too_many = || CommandError::TooManyLevels {
        column_name: column_name.to_owned(),
        num_levels: crate::convert::u64_from(levels.len()),
        max_levels: crate::table::MAX_LEVELS,
    };
    if u32::try_from(levels.len()).map_or(true, |num| num > crate::table::MAX_LEVELS) {
        return Err(too_many());
    }
    let codes = values
        .iter()
        .map(|value| {
            value
                .as_ref()
                .map(|value| {
                    let index = levels
                        .binary_search_by(|level| order(level, value))
                        .map_err(|_| CommandError::Defect {
                            what: format!("a value of column {column_name:?} not among its levels"),
                        })?;
                    u16::try_from(index)
                        .map(LevelCode::new)
                        .map_err(|_| too_many())
                })
                .transpose()
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((levels, codes))
}

/// The values of a column, in the shape its role gives them, each value of
/// its storage type, `None` for a missing value. A decimal number is
/// always finite.
#[derive(Clone, Debug, PartialEq)]
pub enum ColumnValues {
    /// A number.
    Number(Numbers),
    /// A category.
    Category(Categorical),
    /// A classification.
    Classification(Categorical),
    /// Text.
    Text(Vec<Option<String>>),
}

impl ColumnValues {
    /// The values of `stored` in the shape of `role`.
    ///
    /// # Errors
    ///
    /// `RoleNotPossible` when the storage type cannot take the role, and
    /// `TooManyLevels` for a category or a classification of more distinct
    /// values than [`crate::MAX_LEVELS`].
    pub fn from_stored(
        stored: Stored,
        role: Role,
        column: ColumnId,
        column_name: &str,
    ) -> Result<Self, CommandError> {
        let storage = stored.storage_type();
        let impossible = CommandError::RoleNotPossible {
            column,
            storage,
            role,
        };
        match (role, stored) {
            (Role::Number, Stored::Integer(values)) => Ok(Self::Number(Numbers::Integer(values))),
            (Role::Number, Stored::Float(values)) => Ok(Self::Number(Numbers::Float(values))),
            (Role::Text, Stored::Text(values)) => Ok(Self::Text(values)),
            (Role::Category, stored) => Ok(Self::Category(Categorical::from_stored(
                &stored,
                column_name,
            )?)),
            (Role::Classification, stored) => Ok(Self::Classification(Categorical::from_stored(
                &stored,
                column_name,
            )?)),
            (Role::Number, Stored::Boolean(_) | Stored::Text(_))
            | (Role::Text, Stored::Integer(_) | Stored::Float(_) | Stored::Boolean(_)) => {
                Err(impossible)
            }
        }
    }

    /// The values as stored.
    ///
    /// # Errors
    ///
    /// A `Defect` for a code with no level.
    pub fn to_stored(&self) -> Result<Stored, CommandError> {
        Ok(match self {
            Self::Number(Numbers::Integer(values)) => Stored::Integer(values.clone()),
            Self::Number(Numbers::Float(values)) => Stored::Float(values.clone()),
            Self::Text(values) => Stored::Text(values.clone()),
            Self::Category(categorical) | Self::Classification(categorical) => {
                categorical.to_stored()?
            }
        })
    }

    /// The values in the shape of `role`, or `None` when they have it
    /// already. A category and a classification of the same levels change
    /// into each other keeping the levels, their colours and the empty
    /// ones.
    ///
    /// # Errors
    ///
    /// The refusals of [`ColumnValues::from_stored`].
    pub fn with_role(
        &self,
        role: Role,
        column: ColumnId,
        column_name: &str,
    ) -> Result<Option<Self>, CommandError> {
        if self.role() == role {
            return Ok(None);
        }
        match (self, role) {
            (Self::Category(categorical), Role::Classification) => {
                Ok(Some(Self::Classification(categorical.clone())))
            }
            (Self::Classification(categorical), Role::Category) => {
                Ok(Some(Self::Category(categorical.clone())))
            }
            _ => Self::from_stored(self.to_stored()?, role, column, column_name).map(Some),
        }
    }

    /// What the column is for.
    #[must_use]
    pub const fn role(&self) -> Role {
        match self {
            Self::Number(_) => Role::Number,
            Self::Category(_) => Role::Category,
            Self::Classification(_) => Role::Classification,
            Self::Text(_) => Role::Text,
        }
    }

    /// What the values are.
    #[must_use]
    pub const fn storage_type(&self) -> StorageType {
        match self {
            Self::Number(Numbers::Integer(_)) => StorageType::Integer,
            Self::Number(Numbers::Float(_)) => StorageType::Float,
            Self::Text(_) => StorageType::Text,
            Self::Category(categorical) | Self::Classification(categorical) => {
                match categorical.levels {
                    LevelValues::Integer(_) => StorageType::Integer,
                    LevelValues::Float(_) => StorageType::Float,
                    LevelValues::Boolean(_) => StorageType::Boolean,
                    LevelValues::Text(_) => StorageType::Text,
                }
            }
        }
    }

    /// The number of values, one per row.
    #[must_use]
    pub fn len(&self) -> usize {
        match self {
            Self::Number(Numbers::Integer(values)) => values.len(),
            Self::Number(Numbers::Float(values)) => values.len(),
            Self::Text(values) => values.len(),
            Self::Category(categorical) | Self::Classification(categorical) => {
                categorical.codes.len()
            }
        }
    }

    /// Whether the column has no value, as in a table of no row.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
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

    /// The levels and codes of a category or a classification.
    #[must_use]
    pub const fn categorical(&self) -> Option<&Categorical> {
        match &self.values {
            ColumnValues::Category(categorical) | ColumnValues::Classification(categorical) => {
                Some(categorical)
            }
            ColumnValues::Number(_) | ColumnValues::Text(_) => None,
        }
    }

    /// The levels and codes of a classification.
    #[must_use]
    pub const fn classification(&self) -> Option<&Categorical> {
        match &self.values {
            ColumnValues::Classification(categorical) => Some(categorical),
            ColumnValues::Number(_) | ColumnValues::Category(_) | ColumnValues::Text(_) => None,
        }
    }
}

#[cfg(test)]
mod tests;
