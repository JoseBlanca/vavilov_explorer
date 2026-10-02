//! The description of the table a window asks for: its columns, their
//! storage types and roles, and the values and colours of the levels
//! (`docs/core.md`, section 5). It changes when a table is loaded and when
//! a column's role changes, which the revision of the shape follows.

use std::cmp::Ordering;

use serde::Serialize;

use crate::convert::u64_from;
use crate::error::CommandError;
use crate::ids::{ColumnId, Revision};
use crate::session::Session;
use crate::table::{Categorical, Colour, ColumnValues, LevelValues, Numbers, StorageType};

/// The table of the open project, as a window describes it to the user.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDescription {
    /// The revision at which the table was loaded; the window keeps a
    /// description only for the load its copy holds.
    pub loaded_at: Revision,
    /// The revision at which the columns, their names or their roles last
    /// changed; the window asks again when its copy's grows.
    pub shape_at: Revision,
    /// The number of rows, one per individual.
    pub num_rows: u32,
    /// The first column, which names the individuals.
    pub names: NamesDescription,
    /// The other columns, in their order.
    pub columns: Vec<ColumnDescription>,
}

/// The first column.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamesDescription {
    /// Its id.
    pub id: ColumnId,
    /// Its header, which may be empty.
    pub header: String,
}

/// A column other than the first.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDescription {
    /// Its id.
    pub id: ColumnId,
    /// Its name.
    pub name: String,
    /// The revision at which it last changed.
    pub revision: Revision,
    /// What its values are.
    pub storage: StorageType,
    /// What it is for, with what its role needs, as `"role"` in JSON.
    #[serde(flatten)]
    pub role: RoleDescription,
}

/// The role of a column, with the levels of a category or a
/// classification, or the number of distinct values of the others, which
/// says whether they can become one (at most [`crate::MAX_LEVELS`]).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "role",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RoleDescription {
    /// A number.
    Number {
        /// Its distinct values, missing ones left out.
        num_distinct: u64,
    },
    /// A category.
    Category {
        /// The levels, in the order of their codes.
        levels: Vec<LevelDescription>,
    },
    /// A classification.
    Classification {
        /// The levels, in the order of their codes.
        levels: Vec<LevelDescription>,
    },
    /// Text.
    Text {
        /// Its distinct values, missing ones left out.
        num_distinct: u64,
    },
}

/// A level of a category or a classification: in a classification, a
/// population.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelDescription {
    /// Its value, of the column's storage type.
    pub value: LevelValue,
    /// Its colour, as CSS writes it, `#rrggbb`.
    pub colour: String,
}

/// The value of a level in JSON: a whole number as text, since a JSON
/// number cannot hold every 64-bit integer exactly; a decimal number as a
/// number, which JSON holds exactly; yes or no as a boolean; text as text.
/// The column's storage type says which.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum LevelValue {
    /// Text, or a whole number written in decimal digits.
    Text(String),
    /// A decimal number.
    Float(f64),
    /// Yes or no.
    Boolean(bool),
}

impl Session {
    /// The description of the open project's table.
    ///
    /// # Errors
    ///
    /// `NoProject` when no project is open.
    pub fn describe(&self) -> Result<TableDescription, CommandError> {
        let open = self.state.project.open()?;
        let table = &open.table;
        let names = table.names();
        Ok(TableDescription {
            loaded_at: self.state.loaded_at,
            shape_at: open.shape_at,
            num_rows: table.num_rows(),
            names: NamesDescription {
                id: names.id(),
                header: names.header().to_owned(),
            },
            columns: table
                .columns()
                .iter()
                .map(|column| ColumnDescription {
                    id: column.id(),
                    name: column.name().to_owned(),
                    revision: column.revision(),
                    storage: column.values().storage_type(),
                    role: role_of(column.values()),
                })
                .collect(),
        })
    }
}

fn role_of(values: &ColumnValues) -> RoleDescription {
    match values {
        ColumnValues::Number(Numbers::Integer(values)) => RoleDescription::Number {
            num_distinct: distinct(values, i64::cmp),
        },
        ColumnValues::Number(Numbers::Float(values)) => RoleDescription::Number {
            num_distinct: distinct(values, |a, b| {
                a.partial_cmp(b).unwrap_or_else(|| a.total_cmp(b))
            }),
        },
        ColumnValues::Text(values) => RoleDescription::Text {
            num_distinct: distinct(values, String::cmp),
        },
        ColumnValues::Category(categorical) => RoleDescription::Category {
            levels: levels_of(categorical),
        },
        ColumnValues::Classification(categorical) => RoleDescription::Classification {
            levels: levels_of(categorical),
        },
    }
}

/// The number of distinct values, missing ones left out.
fn distinct<T>(values: &[Option<T>], order: impl Fn(&T, &T) -> Ordering) -> u64 {
    let mut present: Vec<&T> = values.iter().flatten().collect();
    present.sort_by(|a, b| order(a, b));
    present.dedup_by(|a, b| order(a, b).is_eq());
    u64_from(present.len())
}

fn levels_of(categorical: &Categorical) -> Vec<LevelDescription> {
    let values: Vec<LevelValue> = match categorical.levels() {
        LevelValues::Integer(values) => values
            .iter()
            .map(|value| LevelValue::Text(value.to_string()))
            .collect(),
        LevelValues::Float(values) => values.iter().copied().map(LevelValue::Float).collect(),
        LevelValues::Boolean(values) => values.iter().copied().map(LevelValue::Boolean).collect(),
        LevelValues::Text(values) => values.iter().cloned().map(LevelValue::Text).collect(),
    };
    values
        .into_iter()
        .zip(categorical.colours())
        .map(|(value, colour)| LevelDescription {
            value,
            colour: css(*colour),
        })
        .collect()
}

/// A colour as CSS writes it.
fn css(colour: Colour) -> String {
    format!("#{:02x}{:02x}{:02x}", colour.red, colour.green, colour.blue)
}

#[cfg(test)]
mod tests;
