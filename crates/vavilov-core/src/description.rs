//! The description of the table a window asks for: its columns, their
//! types, and the names and colours of the levels (`docs/core.md`,
//! section 5). It changes only when a table is loaded, until the commands
//! on the shape of the table exist.

use serde::Serialize;

use crate::error::CommandError;
use crate::ids::{ColumnId, Revision};
use crate::session::Session;
use crate::table::{Colour, ColumnValues};

/// The table of the open project, as a window describes it to the user.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDescription {
    /// The revision at which the table was loaded; the window keeps a
    /// description only for the load its copy holds.
    pub loaded_at: Revision,
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
    /// Its type, with the levels of a categorical column.
    #[serde(flatten)]
    pub kind: ColumnKind,
}

/// The type of a column, as `"type"` in JSON.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ColumnKind {
    /// Numbers.
    Numeric,
    /// Whole numbers.
    Integer,
    /// Texts.
    Text,
    /// True or false.
    Boolean,
    /// Codes into its levels.
    Categorical {
        /// The levels, in the order of their codes.
        levels: Vec<LevelDescription>,
    },
}

/// A level of a categorical column: in a classification, a population.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelDescription {
    /// Its name.
    pub name: String,
    /// Its colour, as CSS writes it, `#rrggbb`.
    pub colour: String,
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
                    kind: kind_of(column.values()),
                })
                .collect(),
        })
    }
}

fn kind_of(values: &ColumnValues) -> ColumnKind {
    match values {
        ColumnValues::Numeric(_) => ColumnKind::Numeric,
        ColumnValues::Integer(_) => ColumnKind::Integer,
        ColumnValues::Text(_) => ColumnKind::Text,
        ColumnValues::Boolean(_) => ColumnKind::Boolean,
        ColumnValues::Categorical(categorical) => ColumnKind::Categorical {
            levels: categorical
                .levels()
                .iter()
                .map(|level| LevelDescription {
                    name: level.name().to_owned(),
                    colour: css(level.colour()),
                })
                .collect(),
        },
    }
}

/// A colour as CSS writes it.
fn css(colour: Colour) -> String {
    format!("#{:02x}{:02x}{:02x}", colour.red, colour.green, colour.blue)
}

#[cfg(test)]
mod tests;
