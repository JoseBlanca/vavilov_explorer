//! The tables a test loads, described in its JSON.

use serde::Deserialize;
use vavilov_core::{
    Categorical, Colour, ColumnId, ColumnValues, Command, CommandError, Level, LevelCode,
    NewColumn, Request, Session, Table,
};

/// A table as a test describes it: the first column, then columns of
/// numbers, whole numbers, texts, booleans or codes, `null` for a missing
/// value.
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
}

/// Loads the table into the session, as the import will.
pub(crate) fn load(session: &mut Session, spec: TableSpec) -> Result<(), CommandError> {
    let columns = spec
        .columns
        .into_iter()
        .map(column)
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
    })?;
    Ok(())
}

fn column(spec: ColumnSpec) -> Result<NewColumn, CommandError> {
    let values = match (
        spec.numeric,
        spec.integer,
        spec.text,
        spec.boolean,
        spec.levels,
        spec.codes,
    ) {
        (Some(values), None, None, None, None, None) => ColumnValues::Numeric(values),
        (None, Some(values), None, None, None, None) => ColumnValues::Integer(values),
        (None, None, Some(values), None, None, None) => ColumnValues::Text(values),
        (None, None, None, Some(values), None, None) => ColumnValues::Boolean(values),
        (None, None, None, None, Some(levels), Some(codes)) => {
            let levels = levels
                .into_iter()
                .map(|(name, [red, green, blue])| Level::new(name, Colour { red, green, blue }))
                .collect();
            let codes = codes
                .into_iter()
                .map(|code| code.map(LevelCode::new))
                .collect();
            ColumnValues::Categorical(Categorical::new(levels, codes))
        }
        _ => {
            return Err(CommandError::Defect {
                what: format!(
                    "column {} of a test has not exactly one type of values",
                    spec.name
                ),
            });
        }
    };
    Ok(NewColumn {
        name: spec.name,
        values,
    })
}
