//! The description of the table a window asks for: its columns, their
//! storage types and roles, and the values and colours of the levels
//! (`docs/core.md`, section 5). It changes when a table is loaded and when
//! a column's role changes, which the revision of the shape follows.

use serde::Serialize;

use crate::error::CommandError;
use crate::ids::{ColumnId, Revision};
use crate::session::Session;
use crate::table::{Categorical, Colour, LevelValues, Role, StorageType};

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
    /// Its header, IndividualID.
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
    /// What it is for.
    pub role: Role,
    /// The roles it can take, its own among them, in the order of
    /// [`Role::ALL`]: what the dropdown of its role offers.
    pub roles: Vec<Role>,
    /// The levels of a category, of countries or not,
    /// in the order of their codes; absent for the other roles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub levels: Option<Vec<LevelDescription>>,
}

/// A level of a category: in a classification, a
/// group.
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
        let columns = table
            .columns()
            .iter()
            .map(|column| {
                let values = column.values();
                Ok(ColumnDescription {
                    id: column.id(),
                    name: column.name().to_owned(),
                    revision: column.revision(),
                    storage: values.storage_type(),
                    role: values.role(),
                    roles: values.possible_roles()?,
                    levels: values.categorical().map(levels_of),
                })
            })
            .collect::<Result<Vec<_>, CommandError>>()?;
        Ok(TableDescription {
            loaded_at: self.state.loaded_at,
            shape_at: open.shape_at,
            num_rows: table.num_rows(),
            names: NamesDescription {
                id: names.id(),
                header: names.header().to_owned(),
            },
            columns,
        })
    }
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
