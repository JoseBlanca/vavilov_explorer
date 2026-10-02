//! What a window's call to a command asks of the session: the arguments
//! read, checked and turned into a request of the core, then dispatched.
//! The Tauri commands and the test program behind the e2e harness both
//! call [`call`], so the harness tests the windows against the app's own
//! reading of their calls (`docs/core.md`, section 7). `subscribe` is not
//! here: each side has its own transport for the channel.

use std::str::FromStr;

use serde::Deserialize;
use tauri::http::HeaderMap;
use tauri::ipc::InvokeBody;
use vavilov_core::{
    ColumnId, Command, CommandError, LevelCode, Outcome, Request, Revision, Role, RowIndex,
    RowsRequest, Selected, SentAt, Session, TableDescription,
};

/// The commands `call` takes, every command of the app but `subscribe`.
pub const COMMANDS: &[&str] = &[
    "describe_table",
    "fetch_rows",
    "set_selection",
    "assign_rows",
    "unassign_rows",
    "set_hover",
    "set_active_classification",
    "select_population",
    "set_role",
    "undo",
    "redo",
];

/// Applies the call of `command` with its body and headers to the session.
/// A command with rows takes them as a raw body, one bit per row, with the
/// headers `based-on`, `sent-at` and, for a lasso, `column` and `target`
/// (add mode: a code, or `unassigned`) or `population` (remove mode); the
/// others take JSON arguments in camelCase, and an
/// argument the command does not have is refused, so that a name that
/// drifts between a window and the app fails at once.
///
/// # Errors
///
/// The refusals of the dispatcher, or a `Defect` for an unknown command,
/// an argument or a header missing, unknown or of the wrong type, and a
/// JSON body where raw bytes belong.
pub fn call(
    session: &mut Session,
    command: &str,
    body: &InvokeBody,
    headers: &HeaderMap,
) -> Result<Reply, CommandError> {
    if command == "describe_table" {
        json_args::<Nothing>(command, body)?;
        return session.describe().map(Reply::Description);
    }
    if command == "fetch_rows" {
        let args: RowsArgs = json_args(command, body)?;
        let request = RowsRequest {
            first: RowIndex::new(args.first),
            count: args.count,
            columns: args.columns.into_iter().map(ColumnId::new).collect(),
            based_on: Revision::new(args.based_on),
        };
        return session.rows(&request).map(Reply::Rows);
    }
    let request = match command {
        "set_selection" => {
            let based_on = Revision::new(header(headers, "based-on")?);
            let sent_at = sent_at_header(headers)?;
            let rows = session.rows_from_window(raw_body(body)?, based_on)?;
            Request {
                command: Command::SetSelection { rows },
                based_on,
                sent_at,
            }
        }
        "assign_rows" => {
            let column = ColumnId::new(header(headers, "column")?);
            let target = target_header(headers)?;
            let based_on = Revision::new(header(headers, "based-on")?);
            let sent_at = sent_at_header(headers)?;
            let rows = session.rows_from_window(raw_body(body)?, based_on)?;
            Request {
                command: Command::AssignRows {
                    column,
                    target,
                    rows,
                },
                based_on,
                sent_at,
            }
        }
        "unassign_rows" => {
            let column = ColumnId::new(header(headers, "column")?);
            let population = LevelCode::new(header(headers, "population")?);
            let based_on = Revision::new(header(headers, "based-on")?);
            let sent_at = sent_at_header(headers)?;
            let rows = session.rows_from_window(raw_body(body)?, based_on)?;
            Request {
                command: Command::UnassignRows {
                    column,
                    population,
                    rows,
                },
                based_on,
                sent_at,
            }
        }
        "set_hover" => {
            let args: HoverArgs = json_args(command, body)?;
            request(
                Command::SetHover {
                    row: args.row.map(RowIndex::new),
                },
                args.based_on,
                args.sent_at,
            )?
        }
        "set_active_classification" => {
            let args: ActiveArgs = json_args(command, body)?;
            let column = args.column.map(ColumnId::new);
            request(
                Command::SetActiveClassification { column },
                args.based_on,
                args.sent_at,
            )?
        }
        "select_population" => {
            let args: PopulationArgs = json_args(command, body)?;
            let command = Command::SelectPopulation {
                column: ColumnId::new(args.column),
                selected: args.selected,
            };
            request(command, args.based_on, args.sent_at)?
        }
        "set_role" => {
            let args: RoleArgs = json_args(command, body)?;
            let command = Command::SetRole {
                column: ColumnId::new(args.column),
                role: args.role,
            };
            request(command, args.based_on, args.sent_at)?
        }
        "undo" => {
            let args: At = json_args(command, body)?;
            request(Command::Undo, args.based_on, args.sent_at)?
        }
        "redo" => {
            let args: At = json_args(command, body)?;
            request(Command::Redo, args.based_on, args.sent_at)?
        }
        other => {
            return Err(CommandError::Defect {
                what: format!("a call to an unknown command {other}"),
            });
        }
    };
    session.dispatch(request).map(Reply::Applied)
}

/// What a call gives back.
#[derive(Debug)]
pub enum Reply {
    /// A command applied, with the windows whose channel failed.
    Applied(Outcome),
    /// The description of the table, for `describe_table`.
    Description(TableDescription),
    /// A page of rows, as the bytes of a message of rows, for `fetch_rows`.
    Rows(Vec<u8>),
}

/// The arguments of a command that takes none.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Nothing {}

/// The arguments of undo and redo: the revision and the time every JSON
/// call carries. Each struct names them itself, since serde does not refuse
/// unknown fields through a flattened one.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct At {
    based_on: u64,
    sent_at: Option<f64>,
}

/// The arguments of `fetch_rows`, which changes nothing and so carries
/// no time.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RowsArgs {
    first: u32,
    count: u32,
    columns: Vec<u32>,
    based_on: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HoverArgs {
    row: Option<u32>,
    based_on: u64,
    sent_at: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveArgs {
    column: Option<u32>,
    based_on: u64,
    sent_at: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PopulationArgs {
    column: u32,
    selected: Option<Selected>,
    based_on: u64,
    sent_at: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoleArgs {
    column: u32,
    role: Role,
    based_on: u64,
    sent_at: Option<f64>,
}

fn request(command: Command, based_on: u64, sent_at: Option<f64>) -> Result<Request, CommandError> {
    let sent_at = sent_at.map(SentAt::new).transpose()?;
    Ok(Request {
        command,
        based_on: Revision::new(based_on),
        sent_at,
    })
}

/// The JSON arguments of a call, with none missing and none unknown.
fn json_args<T: for<'de> Deserialize<'de>>(
    command: &str,
    body: &InvokeBody,
) -> Result<T, CommandError> {
    match body {
        InvokeBody::Json(value) => T::deserialize(value).map_err(|error| CommandError::Defect {
            what: format!("the arguments of {command}: {error}"),
        }),
        InvokeBody::Raw(_) => Err(CommandError::Defect {
            what: format!("{command}, which takes JSON arguments, was given raw bytes"),
        }),
    }
}

/// The bytes of a raw body.
fn raw_body(body: &InvokeBody) -> Result<&[u8], CommandError> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(CommandError::Defect {
            what: "a command that takes raw bytes was given JSON, as Tauri sends every \
                   body once a window has fallen back from its custom IPC protocol to postMessage"
                .to_owned(),
        }),
    }
}

/// The value of a header the command needs.
fn header<T: FromStr>(headers: &HeaderMap, name: &str) -> Result<T, CommandError> {
    optional_header(headers, name)?.ok_or_else(|| CommandError::Defect {
        what: format!("a command without its header {name}"),
    })
}

fn optional_header<T: FromStr>(headers: &HeaderMap, name: &str) -> Result<Option<T>, CommandError> {
    let Some(value) = headers.get(name) else {
        return Ok(None);
    };
    value
        .to_str()
        .ok()
        .and_then(|text| text.parse().ok())
        .map(Some)
        .ok_or_else(|| CommandError::Defect {
            what: format!("a header {name} that does not parse"),
        })
}

/// The target of a lasso in add mode, the header `target`: the code of a
/// population, or `unassigned`.
fn target_header(headers: &HeaderMap) -> Result<Selected, CommandError> {
    let text: String = header(headers, "target")?;
    if text == "unassigned" {
        return Ok(Selected::Unassigned);
    }
    text.parse()
        .map(|code| Selected::Population(LevelCode::new(code)))
        .map_err(|_| CommandError::Defect {
            what: format!("a header target of {text:?}"),
        })
}

fn sent_at_header(headers: &HeaderMap) -> Result<Option<SentAt>, CommandError> {
    optional_header::<f64>(headers, "sent-at")?
        .map(SentAt::new)
        .transpose()
}

#[cfg(test)]
mod tests;
