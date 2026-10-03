//! A column of the table other than the first: its values, held in the
//! shape its role gives them, and the storage type they keep
//! (`docs/design.md`, section 6).

use serde::{Deserialize, Serialize};

use crate::countries::country_code;
use crate::error::CommandError;
use crate::ids::{ColumnId, LevelCode, Revision, RowIndex};
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

/// What a column is for, which the user chooses. Latitude and longitude
/// are sub-roles of a number, and country of a category: each behaves as
/// the role above it, with a check of every value (`docs/design.md`,
/// section 6). Any category can be the active classification.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    /// Drawn on an axis, in a histogram or as coordinates.
    Number,
    /// A number from −90 to 90.
    Latitude,
    /// A number from −180 to 180.
    Longitude,
    /// Values that divide the individuals into groups, drawn in a bar plot;
    /// the one being edited is the active classification.
    Category,
    /// A category whose every value is a country, shown by its code.
    Country,
    /// Notes and identifiers, shown in the table alone.
    Text,
}

impl Role {
    /// Every role, in the order the dropdown of a column lists them.
    pub const ALL: [Self; 6] = [
        Self::Number,
        Self::Latitude,
        Self::Longitude,
        Self::Category,
        Self::Country,
        Self::Text,
    ];

    /// Whether the role holds codes into levels: a category, of countries
    /// or not, which can be the active classification.
    #[must_use]
    pub const fn is_categorical(self) -> bool {
        match self {
            Self::Category | Self::Country => true,
            Self::Number | Self::Latitude | Self::Longitude | Self::Text => false,
        }
    }
}

/// The range of a latitude, in degrees.
pub const LATITUDE: std::ops::RangeInclusive<f64> = -90.0..=90.0;

/// The range of a longitude, in degrees.
pub const LONGITUDE: std::ops::RangeInclusive<f64> = -180.0..=180.0;

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

/// The values of the levels of a category, in the
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

    /// The index of `level` among the levels: a number by its value, so
    /// that −0 is the level 0, a text exactly. `None` when no level is it,
    /// or when it is of another storage type.
    pub(crate) fn position(&self, level: &Level) -> Option<usize> {
        match (self, level) {
            (Self::Integer(values), Level::Integer(wanted)) => {
                values.iter().position(|value| value == wanted)
            }
            (Self::Float(values), Level::Float(wanted)) => values
                .iter()
                .position(|value| float_order(value, wanted).is_eq()),
            (Self::Boolean(values), Level::Boolean(wanted)) => {
                values.iter().position(|value| value == wanted)
            }
            (Self::Text(values), Level::Text(wanted)) => {
                values.iter().position(|value| value == wanted)
            }
            (Self::Integer(_) | Self::Float(_) | Self::Boolean(_) | Self::Text(_), _) => None,
        }
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

    /// Inserts `level` at `index`, which is at most the number of levels.
    fn insert(&mut self, index: usize, level: Level) -> Result<(), CommandError> {
        if index > self.len() {
            return Err(CommandError::Defect {
                what: format!("a level inserted at {index} among {}", self.len()),
            });
        }
        match (self, level) {
            (Self::Integer(values), Level::Integer(value)) => values.insert(index, value),
            (Self::Float(values), Level::Float(value)) => values.insert(index, value),
            (Self::Boolean(values), Level::Boolean(value)) => values.insert(index, value),
            (Self::Text(values), Level::Text(value)) => values.insert(index, value),
            (
                levels @ (Self::Integer(_) | Self::Float(_) | Self::Boolean(_) | Self::Text(_)),
                level,
            ) => {
                return Err(other_type(levels, &level));
            }
        }
        Ok(())
    }

    /// Removes and gives the level at `index`, or `None` when there is none.
    fn remove(&mut self, index: usize) -> Option<Level> {
        if index >= self.len() {
            return None;
        }
        Some(match self {
            Self::Integer(values) => Level::Integer(values.remove(index)),
            Self::Float(values) => Level::Float(values.remove(index)),
            Self::Boolean(values) => Level::Boolean(values.remove(index)),
            Self::Text(values) => Level::Text(values.remove(index)),
        })
    }

    /// Makes the level at `index` `level`, and gives the one it was.
    fn replace(&mut self, index: usize, level: Level) -> Result<Level, CommandError> {
        let missing = || CommandError::Defect {
            what: format!("the level at {index}, which is not there"),
        };
        match (self, level) {
            (Self::Integer(values), Level::Integer(value)) => values
                .get_mut(index)
                .map(|slot| Level::Integer(std::mem::replace(slot, value)))
                .ok_or_else(missing),
            (Self::Float(values), Level::Float(value)) => values
                .get_mut(index)
                .map(|slot| Level::Float(std::mem::replace(slot, value)))
                .ok_or_else(missing),
            (Self::Boolean(values), Level::Boolean(value)) => values
                .get_mut(index)
                .map(|slot| Level::Boolean(std::mem::replace(slot, value)))
                .ok_or_else(missing),
            (Self::Text(values), Level::Text(value)) => values
                .get_mut(index)
                .map(|slot| Level::Text(std::mem::replace(slot, value)))
                .ok_or_else(missing),
            (
                levels @ (Self::Integer(_) | Self::Float(_) | Self::Boolean(_) | Self::Text(_)),
                level,
            ) => Err(other_type(levels, &level)),
        }
    }
}

/// The defect of `level` put among `levels` of another storage type.
fn other_type(levels: &LevelValues, level: &Level) -> CommandError {
    CommandError::Defect {
        what: format!("a level {level:?} among levels of {} values", levels.len()),
    }
}

/// One level of a category, of the column's storage type.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Level {
    /// A whole number.
    Integer(i64),
    /// A decimal number, finite.
    Float(f64),
    /// Yes or no.
    Boolean(bool),
    /// A text, not empty.
    Text(String),
}

/// The values of a category: its ordered levels,
/// each with a colour, and for each row the code of its level or `None`,
/// which in a classification is an unassigned individual. A level no row
/// uses is allowed: it is how a new, empty group exists.
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

    /// The storage type of the levels.
    #[must_use]
    pub const fn storage_type(&self) -> StorageType {
        match self.levels {
            LevelValues::Integer(_) => StorageType::Integer,
            LevelValues::Float(_) => StorageType::Float,
            LevelValues::Boolean(_) => StorageType::Boolean,
            LevelValues::Text(_) => StorageType::Text,
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

    /// The category with `level`, of `colour`, inserted at `code`, so that
    /// each level from `code` on takes the code after its own, and with
    /// `rows`, which held no level, given it: a new group, last and
    /// with no rows, or one deleted given back.
    ///
    /// # Errors
    ///
    /// A `Defect`, since the caller checked each of these: a code beyond
    /// the one after the last level, a category of [`crate::MAX_LEVELS`]
    /// levels, a level of another storage type or one the category has, or
    /// a row beyond the table or one that holds a level.
    pub(crate) fn with_level_at(
        &self,
        code: LevelCode,
        level: Level,
        colour: Colour,
        rows: &[RowIndex],
    ) -> Result<Self, CommandError> {
        let defect = |what: String| CommandError::Defect {
            what: format!("a level inserted at {code} into a category {what}"),
        };
        if self.levels.position(&level).is_some() {
            return Err(defect(format!("that has it, {level:?}")));
        }
        let index = usize::from(code.get());
        let num_levels = self.levels.len();
        if index > num_levels || index > self.colours.len() {
            return Err(defect(format!("of {num_levels} levels")));
        }
        if num_levels >= crate::table::MAX_LEVELS_USIZE {
            return Err(defect("that has every code".to_owned()));
        }
        let mut levels = self.levels.clone();
        levels.insert(index, level)?;
        let mut colours = self.colours.clone();
        colours.insert(index, colour);
        let mut codes = self
            .codes
            .iter()
            .map(|held| match held {
                Some(held) if held.get() >= code.get() => held
                    .get()
                    .checked_add(1)
                    .map(|next| Some(LevelCode::new(next)))
                    .ok_or_else(|| defect("whose codes are full".to_owned())),
                Some(_) | None => Ok(*held),
            })
            .collect::<Result<Vec<_>, _>>()?;
        for row in rows {
            match codes.get_mut(crate::convert::usize_from(row.get())) {
                Some(slot @ None) => *slot = Some(code),
                Some(Some(_)) => return Err(defect(format!("for row {row}, which holds one"))),
                None => return Err(defect(format!("for row {row}, beyond the table"))),
            }
        }
        Ok(Self {
            levels,
            colours,
            codes,
        })
    }

    /// The category without the level of `code`, so that each level after
    /// it takes the code before its own, and the rows that held it hold
    /// none; with the level, its colour, and those rows in order.
    ///
    /// # Errors
    ///
    /// A `Defect` for a code with no level, which the caller checked.
    pub(crate) fn without_level(
        &self,
        code: LevelCode,
    ) -> Result<(Self, Level, Colour, Vec<RowIndex>), CommandError> {
        let defect = || CommandError::Defect {
            what: format!(
                "the level {code} deleted from a category of {} levels",
                self.levels.len()
            ),
        };
        let index = usize::from(code.get());
        if index >= self.colours.len() {
            return Err(defect());
        }
        let mut levels = self.levels.clone();
        let level = levels.remove(index).ok_or_else(defect)?;
        let mut colours = self.colours.clone();
        let colour = colours.remove(index);
        let mut rows = Vec::new();
        let mut codes = Vec::with_capacity(self.codes.len());
        for (row, held) in self.codes.iter().enumerate() {
            codes.push(match held {
                Some(held) if *held == code => {
                    rows.push(row_index(row)?);
                    None
                }
                Some(held) if held.get() > code.get() => {
                    held.get().checked_sub(1).map(LevelCode::new)
                }
                Some(_) | None => *held,
            });
        }
        Ok((
            Self {
                levels,
                colours,
                codes,
            },
            level,
            colour,
            rows,
        ))
    }

    /// The category with the level of `code` made `level`, of `colour`, and
    /// the level and colour it had; the codes are the same.
    ///
    /// # Errors
    ///
    /// A `Defect`, since the caller checked each: a code with no level, or
    /// a level of another storage type or another level's.
    pub(crate) fn with_level_set(
        &self,
        code: LevelCode,
        level: Level,
        colour: Colour,
    ) -> Result<(Self, Level, Colour), CommandError> {
        let index = usize::from(code.get());
        if self
            .levels
            .position(&level)
            .is_some_and(|other| other != index)
        {
            return Err(CommandError::Defect {
                what: format!("the level {code} made {level:?}, another level's"),
            });
        }
        let mut levels = self.levels.clone();
        let old_level = levels.replace(index, level)?;
        let mut colours = self.colours.clone();
        let slot = colours.get_mut(index).ok_or_else(|| CommandError::Defect {
            what: format!("the colour of the level {code}, which has none"),
        })?;
        let old_colour = std::mem::replace(slot, colour);
        Ok((
            Self {
                levels,
                colours,
                codes: self.codes.clone(),
            },
            old_level,
            old_colour,
        ))
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
/// always finite; a latitude and a longitude are in their range; the
/// levels of a country category are the codes of
/// countries.
#[derive(Clone, Debug, PartialEq)]
pub enum ColumnValues {
    /// A number.
    Number(Numbers),
    /// A latitude.
    Latitude(Numbers),
    /// A longitude.
    Longitude(Numbers),
    /// A category.
    Category(Categorical),
    /// A category of countries.
    Country(Categorical),
    /// Text.
    Text(Vec<Option<String>>),
}

impl ColumnValues {
    /// The values of `stored` in the shape of `role`. A country role
    /// writes each value as its country's code, so that two spellings of
    /// one country are one level.
    ///
    /// # Errors
    ///
    /// `RoleNotPossible` when the storage type cannot take the role,
    /// `ValueNotFor` for a value a sub-role does not take, a latitude out of
    /// its range or a text that names no country, and `TooManyLevels` for a
    /// category of more distinct values than
    /// [`crate::MAX_LEVELS`].
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
        let numbers = |stored: Stored| match stored {
            Stored::Integer(values) => Ok(Numbers::Integer(values)),
            Stored::Float(values) => Ok(Numbers::Float(values)),
            Stored::Boolean(_) | Stored::Text(_) => Err(impossible.clone()),
        };
        match role {
            Role::Number => Ok(Self::Number(numbers(stored)?)),
            Role::Latitude => {
                let values = numbers(stored)?;
                check_range(&values, &LATITUDE, column, role)?;
                Ok(Self::Latitude(values))
            }
            Role::Longitude => {
                let values = numbers(stored)?;
                check_range(&values, &LONGITUDE, column, role)?;
                Ok(Self::Longitude(values))
            }
            Role::Category => Ok(Self::Category(Categorical::from_stored(
                &stored,
                column_name,
            )?)),
            Role::Country => {
                let Stored::Text(values) = stored else {
                    return Err(impossible);
                };
                let codes = Stored::Text(countries_of(&values, column, role)?);
                Ok(Self::Country(Categorical::from_stored(
                    &codes,
                    column_name,
                )?))
            }
            Role::Text => match stored {
                Stored::Text(values) => Ok(Self::Text(values)),
                Stored::Integer(_) | Stored::Float(_) | Stored::Boolean(_) => Err(impossible),
            },
        }
    }

    /// The values as stored; those of a country role are the codes of the
    /// countries.
    ///
    /// # Errors
    ///
    /// A `Defect` for a code with no level.
    pub fn to_stored(&self) -> Result<Stored, CommandError> {
        Ok(match self {
            Self::Number(numbers) | Self::Latitude(numbers) | Self::Longitude(numbers) => {
                match numbers {
                    Numbers::Integer(values) => Stored::Integer(values.clone()),
                    Numbers::Float(values) => Stored::Float(values.clone()),
                }
            }
            Self::Text(values) => Stored::Text(values.clone()),
            Self::Category(categorical) | Self::Country(categorical) => categorical.to_stored()?,
        })
    }

    /// The values in the shape of `role`, or `None` when they have it
    /// already. The new shape is built from the values as stored.
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
        Self::from_stored(self.to_stored()?, role, column, column_name).map(Some)
    }

    /// The roles the column can take, its own among them, in the order of
    /// [`Role::ALL`]: by its storage type, a category
    /// only when its distinct values fit the codes, and a sub-role only when
    /// every value passes its check.
    ///
    /// # Errors
    ///
    /// A `Defect` for a code with no level.
    pub fn possible_roles(&self) -> Result<Vec<Role>, CommandError> {
        let stored = self.to_stored()?;
        let storage = stored.storage_type();
        let numeric = matches!(storage, StorageType::Integer | StorageType::Float);
        let categorical =
            self.categorical().is_some() || distinct(&stored) <= crate::table::MAX_LEVELS_USIZE;
        let in_range = |range: &std::ops::RangeInclusive<f64>| match &stored {
            Stored::Integer(values) => values.iter().flatten().all(|value| {
                i32::try_from(*value).is_ok_and(|value| range.contains(&f64::from(value)))
            }),
            Stored::Float(values) => values.iter().flatten().all(|value| range.contains(value)),
            Stored::Boolean(_) | Stored::Text(_) => false,
        };
        let countries = match &stored {
            Stored::Text(values) => values
                .iter()
                .flatten()
                .all(|value| country_code(value).is_some()),
            Stored::Integer(_) | Stored::Float(_) | Stored::Boolean(_) => false,
        };
        Ok(Role::ALL
            .into_iter()
            .filter(|role| match role {
                Role::Number => numeric,
                Role::Latitude => numeric && in_range(&LATITUDE),
                Role::Longitude => numeric && in_range(&LONGITUDE),
                Role::Category => categorical,
                Role::Country => countries,
                Role::Text => storage == StorageType::Text,
            })
            .collect())
    }

    /// What the column is for.
    #[must_use]
    pub const fn role(&self) -> Role {
        match self {
            Self::Number(_) => Role::Number,
            Self::Latitude(_) => Role::Latitude,
            Self::Longitude(_) => Role::Longitude,
            Self::Category(_) => Role::Category,
            Self::Country(_) => Role::Country,
            Self::Text(_) => Role::Text,
        }
    }

    /// What the values are.
    #[must_use]
    pub const fn storage_type(&self) -> StorageType {
        match self {
            Self::Number(numbers) | Self::Latitude(numbers) | Self::Longitude(numbers) => {
                match numbers {
                    Numbers::Integer(_) => StorageType::Integer,
                    Numbers::Float(_) => StorageType::Float,
                }
            }
            Self::Text(_) => StorageType::Text,
            Self::Category(categorical) | Self::Country(categorical) => categorical.storage_type(),
        }
    }

    /// The numbers of a number, a latitude or a longitude.
    #[must_use]
    pub const fn numbers(&self) -> Option<&Numbers> {
        match self {
            Self::Number(numbers) | Self::Latitude(numbers) | Self::Longitude(numbers) => {
                Some(numbers)
            }
            Self::Category(_) | Self::Country(_) | Self::Text(_) => None,
        }
    }

    /// The levels and codes of a category, of countries or not.
    #[must_use]
    pub const fn categorical(&self) -> Option<&Categorical> {
        match self {
            Self::Category(categorical) | Self::Country(categorical) => Some(categorical),
            Self::Number(_) | Self::Latitude(_) | Self::Longitude(_) | Self::Text(_) => None,
        }
    }

    /// The levels and codes of a category, to be
    /// changed.
    pub(crate) const fn categorical_mut(&mut self) -> Option<&mut Categorical> {
        match self {
            Self::Category(categorical) | Self::Country(categorical) => Some(categorical),
            Self::Number(_) | Self::Latitude(_) | Self::Longitude(_) | Self::Text(_) => None,
        }
    }

    /// The number of values, one per row.
    #[must_use]
    pub fn len(&self) -> usize {
        match self {
            Self::Number(numbers) | Self::Latitude(numbers) | Self::Longitude(numbers) => {
                match numbers {
                    Numbers::Integer(values) => values.len(),
                    Numbers::Float(values) => values.len(),
                }
            }
            Self::Text(values) => values.len(),
            Self::Category(categorical) | Self::Country(categorical) => categorical.codes.len(),
        }
    }

    /// Whether the column has no value, as in a table of no row.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Checks that every number of `values` is in `range`.
pub(crate) fn check_range(
    values: &Numbers,
    range: &std::ops::RangeInclusive<f64>,
    column: ColumnId,
    role: Role,
) -> Result<(), CommandError> {
    let outside = match values {
        Numbers::Integer(values) => values.iter().position(|value| {
            value.is_some_and(|value| {
                i32::try_from(value).map_or(true, |value| !range.contains(&f64::from(value)))
            })
        }),
        Numbers::Float(values) => values
            .iter()
            .position(|value| value.is_some_and(|value| !range.contains(&value))),
    };
    match outside {
        None => Ok(()),
        Some(row) => Err(CommandError::ValueNotFor {
            column,
            role,
            row: row_index(row)?,
        }),
    }
}

/// The code of the country each text names.
fn countries_of(
    values: &[Option<String>],
    column: ColumnId,
    role: Role,
) -> Result<Vec<Option<String>>, CommandError> {
    values
        .iter()
        .enumerate()
        .map(|(row, value)| {
            value
                .as_deref()
                .map(|text| {
                    country_code(text)
                        .map(str::to_owned)
                        .ok_or(CommandError::ValueNotFor {
                            column,
                            role,
                            row: row_index(row)?,
                        })
                })
                .transpose()
        })
        .collect()
}

/// The number of distinct values, missing ones left out.
fn distinct(stored: &Stored) -> usize {
    fn count<T>(values: &[Option<T>], order: impl Fn(&T, &T) -> std::cmp::Ordering) -> usize {
        let mut present: Vec<&T> = values.iter().flatten().collect();
        present.sort_by(|a, b| order(a, b));
        present.dedup_by(|a, b| order(a, b).is_eq());
        present.len()
    }
    match stored {
        Stored::Integer(values) => count(values, i64::cmp),
        Stored::Float(values) => count(values, float_order),
        Stored::Boolean(values) => count(values, bool::cmp),
        Stored::Text(values) => count(values, String::cmp),
    }
}

/// A row of the table, which has at most [`crate::MAX_ROWS`] rows.
fn row_index(row: usize) -> Result<crate::ids::RowIndex, CommandError> {
    u32::try_from(row)
        .map(crate::ids::RowIndex::new)
        .map_err(|_| CommandError::Defect {
            what: format!("a row {row} beyond a u32"),
        })
}

/// A column of the table other than the first.
#[derive(Clone, Debug, PartialEq)]
pub struct Column {
    pub(crate) id: ColumnId,
    pub(crate) name: String,
    pub(crate) revision: Revision,
    /// The revision at which its levels last changed other than by one
    /// added after the last: the load, a change of role, or a level
    /// removed. A command that names a level and was made before it is
    /// refused, since the code may now mean another group.
    pub(crate) levels_at: Revision,
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

    /// The levels and codes of a category, of countries or not.
    #[must_use]
    pub const fn categorical(&self) -> Option<&Categorical> {
        self.values.categorical()
    }
}

#[cfg(test)]
mod tests;
