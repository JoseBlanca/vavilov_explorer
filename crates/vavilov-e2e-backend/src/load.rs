//! The tables a test loads, described in its JSON.

use serde::Deserialize;
use vavilov_core::{
    Categorical, Colour, ColumnId, ColumnValues, Command, CommandError, LevelCode, LevelValues,
    NewColumn, Outcome, Request, Role, Session, Stored, Table,
};

/// A table as a test describes it: the first column, then columns of
/// numbers, whole numbers, texts or booleans, `null` for a missing value,
/// each with its role, or the levels and codes of a category.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TableSpec {
    header: String,
    names: Vec<String>,
    columns: Vec<ColumnSpec>,
    active_classification: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ColumnSpec {
    name: String,
    numeric: Option<Vec<Option<f64>>>,
    integer: Option<Vec<Option<i64>>>,
    text: Option<Vec<Option<String>>>,
    boolean: Option<Vec<Option<bool>>>,
    levels: Option<Vec<(String, [u8; 3])>>,
    codes: Option<Vec<Option<u16>>>,
    /// The role; without one, a column of numbers is a number, of text
    /// text, and of booleans or of levels a category.
    role: Option<Role>,
}

/// Loads the table into the session, as the import does, and gives what
/// the load did, with the widgets it closed.
pub(crate) fn load(session: &mut Session, spec: TableSpec) -> Result<Outcome, CommandError> {
    let columns = (1..=u32::MAX)
        .zip(spec.columns)
        .map(|(id, column_spec)| column(ColumnId::new(id), column_spec))
        .collect::<Result<Vec<_>, _>>()?;
    let table = Table::new(spec.header, spec.names, columns)?;
    let based_on = session.revision();
    session.dispatch(Request {
        command: Command::LoadTable {
            table,
            active_classification: spec.active_classification.map(ColumnId::new),
        },
        based_on,
        sent_at: None,
    })
}

fn column(id: ColumnId, spec: ColumnSpec) -> Result<NewColumn, CommandError> {
    let not_one = || CommandError::Defect {
        what: format!(
            "column {} of a test has not exactly one kind of values",
            spec.name
        ),
    };
    let values = match (
        spec.numeric,
        spec.integer,
        spec.text,
        spec.boolean,
        spec.levels,
        spec.codes,
    ) {
        (None, None, None, None, Some(levels), Some(codes)) => {
            let (names, colours) = levels
                .into_iter()
                .map(|(name, [red, green, blue])| (name, Colour { red, green, blue }))
                .unzip();
            let codes = codes
                .into_iter()
                .map(|code| code.map(LevelCode::new))
                .collect();
            let categorical = Categorical::new(LevelValues::Text(names), colours, codes);
            match spec.role.unwrap_or(Role::Category) {
                Role::Category => ColumnValues::Category(categorical),
                // A column of countries is given by its values, which the
                // core turns into codes.
                Role::Country | Role::Number | Role::Latitude | Role::Longitude | Role::Text => {
                    return Err(CommandError::Defect {
                        what: format!(
                            "column {} of a test is given by its levels, which only a category takes",
                            spec.name
                        ),
                    });
                }
            }
        }
        (numeric, integer, text, boolean, None, None) => {
            let (stored, guessed) = match (numeric, integer, text, boolean) {
                (Some(values), None, None, None) => (Stored::Float(values), Role::Number),
                (None, Some(values), None, None) => (Stored::Integer(values), Role::Number),
                (None, None, Some(values), None) => (Stored::Text(values), Role::Text),
                (None, None, None, Some(values)) => (Stored::Boolean(values), Role::Category),
                _ => return Err(not_one()),
            };
            ColumnValues::from_stored(stored, spec.role.unwrap_or(guessed), id, &spec.name)?
        }
        _ => return Err(not_one()),
    };
    Ok(NewColumn {
        name: spec.name,
        values,
    })
}
