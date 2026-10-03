//! The table of individuals: the first column, which names them, and the
//! other columns, each with its id, name, type and values
//! (`docs/core.md`, section 2).

mod colour;
mod column;

pub use colour::{Colour, PALETTE, palette};
pub use column::{
    Categorical, Column, ColumnValues, LevelValues, Numbers, Role, StorageType, Stored,
};
pub(crate) use column::{LATITUDE, LONGITUDE, check_range};

use std::collections::{HashMap, HashSet};

use crate::convert::{u64_from, usize_from};
use crate::error::CommandError;
use crate::ids::{ColumnId, LevelCode, Revision, RowIndex};

/// The most rows a table may have, 2^28: with it, the largest part of a
/// message, a column of 8-byte values, fits the `u32` length of the
/// layout (`docs/core.md`, section 2).
pub const MAX_ROWS: u32 = 268_435_456;

/// The most columns a table may have, the first included, 2^24: with it,
/// the list of every column's revision, 16 bytes a column, fits the `u32`
/// length of a part.
pub const MAX_COLUMNS: u32 = 16_777_216;

/// The most levels a category may have: a code is 16
/// bits, and `0xFFFF` means missing in the messages.
pub const MAX_LEVELS: u32 = 65_535;

/// [`MAX_LEVELS`] as a count of values.
pub(crate) const MAX_LEVELS_USIZE: usize = MAX_LEVELS as usize;

/// The header of the first column, which the app shows and an export
/// writes (`docs/design.md`, section 5, decided by the owner on 2 October
/// 2026).
pub const INDIVIDUAL_ID: &str = "IndividualID";

/// Whether `header` names the first column: [`INDIVIDUAL_ID`], with case,
/// spaces and underscores ignored, so that `Individual ID` and
/// `individual_id` are accepted.
#[must_use]
pub fn is_individual_id(header: &str) -> bool {
    let squeezed = |text: &str| -> String {
        text.chars()
            .filter(|c| !c.is_whitespace() && *c != '_')
            .flat_map(char::to_lowercase)
            .collect()
    };
    squeezed(header) == squeezed(INDIVIDUAL_ID)
}

/// The first column, which names the individuals: none empty, no two the
/// same, text as written. It has no type and is never missing, and its
/// header is always [`INDIVIDUAL_ID`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NameColumn {
    id: ColumnId,
    revision: Revision,
    names: Vec<String>,
}

impl NameColumn {
    /// The id of the first column.
    #[must_use]
    pub const fn id(&self) -> ColumnId {
        self.id
    }

    /// The revision of the session at which it last changed: its load, as
    /// no command changes it yet.
    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    /// Its header, [`INDIVIDUAL_ID`], whatever the file wrote of it.
    #[must_use]
    pub const fn header(&self) -> &'static str {
        INDIVIDUAL_ID
    }

    /// The name of each individual, one per row.
    #[must_use]
    pub fn names(&self) -> &[String] {
        &self.names
    }
}

/// A column given to [`Table::new`], before it has an id.
#[derive(Clone, Debug, PartialEq)]
pub struct NewColumn {
    /// The name, not empty and unique within the table.
    pub name: String,
    /// The values, one per row.
    pub values: ColumnValues,
}

/// The table of a project: a fixed number of rows, one per individual, the
/// first column of their names, and the other columns.
#[derive(Clone, Debug, PartialEq)]
pub struct Table {
    num_rows: u32,
    names: NameColumn,
    columns: Vec<Column>,
    next_column_id: u32,
}

impl Table {
    /// The table of these individuals and columns. The first column gets
    /// the id 0 and the others 1, 2 and on, in their order.
    ///
    /// # Errors
    ///
    /// A header of the first column that is not [`INDIVIDUAL_ID`], as
    /// [`is_individual_id`] compares them; a table of more than
    /// [`MAX_ROWS`] rows or [`MAX_COLUMNS`] columns; an individual with no
    /// name, or two with the same; a column with no name, two of the same
    /// name, or one named [`INDIVIDUAL_ID`]; a column of another length
    /// than the names; a number that is not finite; a category of more
    /// than [`MAX_LEVELS`] levels, of another number
    /// of colours than levels, a level of empty text, a level twice, or a
    /// code with no level.
    pub fn new(
        header: impl Into<String>,
        names: Vec<String>,
        columns: Vec<NewColumn>,
    ) -> Result<Self, CommandError> {
        let header = header.into();
        if !is_individual_id(&header) {
            return Err(CommandError::NotIndividualId { header });
        }
        let num_rows = num_rows_of(names.len())?;
        check_num_columns(columns.len())?;
        check_names(&names)?;
        check_column_names(&columns)?;
        // The ids are given below, 1 and on, in the order of the columns.
        for (id, column) in (1..=u32::MAX).zip(&columns) {
            check_values(column, ColumnId::new(id), num_rows)?;
        }
        // The first column is 0 and the others follow; their number was
        // checked to be at most MAX_COLUMNS, so no id reaches u32::MAX.
        let mut next_id: u32 = 1;
        let mut built = Vec::with_capacity(columns.len());
        for column in columns {
            built.push(Column {
                id: ColumnId::new(next_id),
                name: column.name,
                revision: Revision::ZERO,
                values: column.values,
            });
            next_id = next_id.checked_add(1).ok_or_else(|| CommandError::Defect {
                what: "a column id beyond u32".to_owned(),
            })?;
        }
        Ok(Self {
            num_rows,
            names: NameColumn {
                id: ColumnId::new(0),
                revision: Revision::ZERO,
                names,
            },
            columns: built,
            next_column_id: next_id,
        })
    }

    /// The number of rows, one per individual.
    #[must_use]
    pub const fn num_rows(&self) -> u32 {
        self.num_rows
    }

    /// The first column, the names of the individuals.
    #[must_use]
    pub const fn names(&self) -> &NameColumn {
        &self.names
    }

    /// The other columns, in their order.
    #[must_use]
    pub fn columns(&self) -> &[Column] {
        &self.columns
    }

    /// The column of this id, other than the first, which has no type:
    /// look for the first by [`NameColumn::id`].
    #[must_use]
    pub fn column(&self, id: ColumnId) -> Option<&Column> {
        self.columns.iter().find(|column| column.id == id)
    }

    /// The column of this id, to be changed.
    pub(crate) fn column_mut(&mut self, id: ColumnId) -> Option<&mut Column> {
        self.columns.iter_mut().find(|column| column.id == id)
    }

    /// Gives every column the revision at which the table is loaded.
    pub(crate) fn set_revisions(&mut self, revision: Revision) {
        self.names.revision = revision;
        for column in &mut self.columns {
            column.revision = revision;
        }
    }

    /// Gives the individuals `names`, which the caller checked, and the
    /// first column `revision`.
    pub(crate) fn set_names(&mut self, names: Vec<String>, revision: Revision) {
        self.names.names = names;
        self.names.revision = revision;
    }

    /// The id the next column added will get.
    #[must_use]
    pub const fn next_column_id(&self) -> ColumnId {
        ColumnId::new(self.next_column_id)
    }
}

/// The number of rows of a table of `len` individuals.
fn num_rows_of(len: usize) -> Result<u32, CommandError> {
    u32::try_from(len)
        .ok()
        .filter(|num_rows| *num_rows <= MAX_ROWS)
        .ok_or(CommandError::TooManyRows {
            num_rows: u64_from(len),
            max_rows: MAX_ROWS,
        })
}

/// Checks the number of columns of a table of `num_other` columns besides
/// the first.
fn check_num_columns(num_other: usize) -> Result<(), CommandError> {
    let num_columns = u64_from(num_other).saturating_add(1);
    if num_columns > u64::from(MAX_COLUMNS) {
        return Err(CommandError::TooManyColumns {
            num_columns,
            max_columns: MAX_COLUMNS,
        });
    }
    Ok(())
}

/// Checks that every individual has a name and no two the same.
fn check_names(names: &[String]) -> Result<(), CommandError> {
    let mut seen: HashMap<&str, RowIndex> = HashMap::with_capacity(names.len());
    for (row, name) in rows(names) {
        if name.is_empty() {
            return Err(CommandError::EmptyIndividual { row });
        }
        if let Some(first_row) = seen.insert(name, row) {
            return Err(CommandError::DuplicateIndividual {
                name: name.clone(),
                first_row,
                second_row: row,
            });
        }
    }
    Ok(())
}

/// Checks that every column has a name, and no two the same, the first
/// column's header among them.
fn check_column_names(columns: &[NewColumn]) -> Result<(), CommandError> {
    let mut seen: HashSet<&str> = HashSet::with_capacity(columns.len());
    seen.insert(INDIVIDUAL_ID);
    for (position, column) in (1..=u32::MAX).zip(columns) {
        if column.name.is_empty() {
            return Err(CommandError::EmptyColumnName { position });
        }
        if !seen.insert(&column.name) {
            return Err(CommandError::DuplicateColumnName {
                name: column.name.clone(),
            });
        }
    }
    Ok(())
}

/// Checks a column's length, its numbers and its levels and codes.
fn check_values(column: &NewColumn, id: ColumnId, num_rows: u32) -> Result<(), CommandError> {
    let num_values = column.values.len();
    if num_values != usize_from(num_rows) {
        return Err(CommandError::ColumnLength {
            column_name: column.name.clone(),
            num_values: u64_from(num_values),
            num_rows,
        });
    }
    if let Some(Numbers::Float(values)) = column.values.numbers() {
        for (row, value) in rows(values) {
            if value.is_some_and(|value| !value.is_finite()) {
                return Err(CommandError::NonFiniteNumber {
                    column_name: column.name.clone(),
                    row,
                });
            }
        }
    }
    match &column.values {
        ColumnValues::Latitude(numbers) | ColumnValues::Longitude(numbers) => {
            let role = column.values.role();
            let range = if role == Role::Latitude {
                &LATITUDE
            } else {
                &LONGITUDE
            };
            check_range(numbers, range, id, role)
        }
        ColumnValues::Country(categorical) => {
            check_categorical(&column.name, categorical)?;
            check_countries(&column.name, categorical, id, column.values.role())
        }
        ColumnValues::Category(categorical) => check_categorical(&column.name, categorical),
        // A text is never empty, so that a change of role to a category
        // cannot make a level with no name.
        ColumnValues::Text(values) => {
            match rows(values).find(|(_, value)| value.as_ref().is_some_and(String::is_empty)) {
                Some((row, _)) => Err(CommandError::EmptyText {
                    column_name: column.name.clone(),
                    row,
                }),
                None => Ok(()),
            }
        }
        ColumnValues::Number(_) => Ok(()),
    }
}

/// Checks that every level of a country role is a country's code, as the
/// country is shown.
fn check_countries(
    name: &str,
    categorical: &Categorical,
    column: ColumnId,
    role: Role,
) -> Result<(), CommandError> {
    let not_a_country = |level: String| CommandError::NotACountry {
        column_name: name.to_owned(),
        level,
    };
    match categorical.levels() {
        LevelValues::Text(levels) => match levels
            .iter()
            .find(|level| crate::countries::country_code(level) != Some(level.as_str()))
        {
            Some(level) => Err(not_a_country(level.clone())),
            None => Ok(()),
        },
        LevelValues::Integer(_) | LevelValues::Float(_) | LevelValues::Boolean(_) => {
            Err(CommandError::RoleNotPossible {
                column,
                storage: categorical.storage_type(),
                role,
            })
        }
    }
}

/// Checks the levels of a category, their colours,
/// and that every code has a level.
fn check_categorical(name: &str, categorical: &Categorical) -> Result<(), CommandError> {
    let levels = categorical.levels();
    let num_levels = u32::try_from(levels.len())
        .ok()
        .filter(|num| *num <= MAX_LEVELS)
        .ok_or_else(|| CommandError::TooManyLevels {
            column_name: name.to_owned(),
            num_levels: u64_from(levels.len()),
            max_levels: MAX_LEVELS,
        })?;
    if categorical.colours().len() != levels.len() {
        return Err(CommandError::LevelColours {
            column_name: name.to_owned(),
            num_levels: u64_from(levels.len()),
            num_colours: u64_from(categorical.colours().len()),
        });
    }
    let repeated = match levels {
        LevelValues::Integer(values) => repeated(values, i64::cmp),
        // Two levels are one number when they are equal as numbers, so
        // that −0 and 0 are one.
        LevelValues::Float(values) => {
            if let Some(row) = values.iter().position(|value| !value.is_finite()) {
                return Err(CommandError::NonFiniteLevel {
                    column_name: name.to_owned(),
                    code: level_code(row)?,
                });
            }
            repeated(values, |a, b| {
                a.partial_cmp(b).unwrap_or_else(|| a.total_cmp(b))
            })
        }
        LevelValues::Boolean(values) => repeated(values, bool::cmp),
        LevelValues::Text(values) => {
            if let Some(index) = values.iter().position(String::is_empty) {
                return Err(CommandError::EmptyLevelName {
                    column_name: name.to_owned(),
                    code: level_code(index)?,
                });
            }
            repeated(values, String::cmp)
        }
    };
    if let Some(index) = repeated {
        return Err(CommandError::DuplicateLevel {
            column_name: name.to_owned(),
            level: levels.text_of(index).ok_or_else(|| CommandError::Defect {
                what: format!("no level {index} of column {name:?}"),
            })?,
        });
    }
    for (row, code) in rows(categorical.codes()) {
        if let Some(code) = code
            && u32::from(code.get()) >= num_levels
        {
            return Err(CommandError::CodeWithoutLevel {
                column_name: name.to_owned(),
                row,
                code: *code,
                num_levels,
            });
        }
    }
    Ok(())
}

/// The index of a value equal to another, by `order`, or `None` when
/// every value is distinct. It sorts, so that 65,535 levels take a few
/// million comparisons and not two billion.
fn repeated<T>(values: &[T], order: impl Fn(&T, &T) -> std::cmp::Ordering) -> Option<usize> {
    let mut sorted: Vec<(usize, &T)> = values.iter().enumerate().collect();
    sorted.sort_by(|(_, a), (_, b)| order(a, b));
    sorted.windows(2).find_map(|pair| match pair {
        [(_, first), (index, second)] => order(first, second).is_eq().then_some(*index),
        _ => None,
    })
}

/// The code of the level at `index`, which the number of levels was
/// checked to fit.
fn level_code(index: usize) -> Result<LevelCode, CommandError> {
    u16::try_from(index)
        .map(LevelCode::new)
        .map_err(|_| CommandError::Defect {
            what: format!("a level at {index}, beyond the codes"),
        })
}

/// The values of a column with their rows. The table has at most
/// MAX_ROWS rows, checked before any column is walked, so every row fits
/// a `u32`.
fn rows<T>(values: &[T]) -> impl Iterator<Item = (RowIndex, &T)> {
    (0..=u32::MAX).map(RowIndex::new).zip(values)
}

#[cfg(test)]
mod tests;
